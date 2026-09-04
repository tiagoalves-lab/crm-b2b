/**
 * Leads do Meta → CRM Gama (Google Apps Script)
 *
 * Roda dentro do Google, na conta de quem instalou, e manda pro CRM cada
 * linha nova da aba "Query CRM" da planilha "LEADS GAMA DB" — planilha do
 * próprio usuário, que espelha (IMPORTRANGE) a planilha em que o gestor de
 * tráfego despeja a Central de Leads do Meta. É o "webhook" da planilha: o
 * CRM (POST /integrations/meta-leads/planilha, ver docs/webhook-meta-leads.md)
 * confere o token, ignora o que já recebeu e cria o lead na Prospecção com
 * a tag "Meta Business".
 *
 * A planilha é SÓ porta de entrada: este script nunca escreve nela. Quem
 * decide o que já foi enviado é o CRM (dedupe pelo id do lead); a lista
 * local de enviados abaixo existe só pra não mandar a planilha inteira a
 * cada rodada.
 *
 * O TOKEN NÃO FICA NESTE CÓDIGO. Na instalação o próprio script gera um
 * token e guarda nas Propriedades do script (visível só pra quem edita
 * este projeto); o mesmo valor é copiado pra variável
 * META_LEADS_PLANILHA_TOKEN no Railway. Mesmo molde da integração com o
 * app de cotações.
 *
 * INSTALAÇÃO (uma vez):
 *   1. Na planilha "LEADS GAMA DB": menu Extensões → Apps Script. Cole este
 *      arquivo inteiro no lugar do conteúdo (Código.gs) e salve (Ctrl+S).
 *   2. Ao lado de "Executar", escolha `crm_instalar` e clique em Executar.
 *      Na primeira vez o Google pede autorização: "Revisar permissões" →
 *      sua conta → "Avançado" → "Acessar (não seguro)" → Permitir. É o
 *      aviso padrão pra script feito por você mesmo.
 *   3. Abra "Registro de execução": o script mostra o token gerado. Copie e
 *      cole no Railway (serviço backend → Variables →
 *      META_LEADS_PLANILHA_TOKEN). O Railway republica sozinho em ~2 min.
 *   4. Rode `crm_enviar` uma vez pra confirmar (ou espere: o script roda
 *      sozinho a cada 5 minutos e quando a planilha muda).
 *
 * OPERAÇÃO:
 *   - `crm_status`          → gatilhos, aba, último envio e último erro.
 *   - `crm_enviar`          → força um envio agora.
 *   - `crm_mostrar_token`   → mostra o token de novo (pra conferir no Railway).
 *   - `crm_gerar_novo_token`→ troca o token (depois, atualizar no Railway).
 *   - `crm_reenviar_tudo`   → esquece a lista local e manda a planilha inteira
 *                             de novo (o CRM ignora o que já tem — seguro).
 *   - `crm_desinstalar`     → remove os gatilhos (o script para de rodar).
 */

// ── Configuração ─────────────────────────────────────────────────────────

// Id da planilha "LEADS GAMA DB" (está na URL dela, entre /d/ e /edit).
var PLANILHA_ID = '1YmXXDCwAR4FviLZ5_R6_Flm9NRqSJ-78vo7490PkeqQ';

// Aba que o CRM lê. O nome da aba e os nomes das colunas são o contrato
// com o gestor de tráfego — se mudar, o envio para (ver crm_status).
var ABA = 'Query CRM';

// Endereço do CRM (backend no Railway).
var CRM_URL =
  'https://backend-production-bc44.up.railway.app/integrations/meta-leads/planilha';

// Quantas linhas por requisição (o CRM aceita até 100).
var LOTE = 50;

// Quantos ids guardar na lista local de enviados. Passou disso, esquece os
// mais antigos — se voltarem a ser enviados, o CRM ignora (já tem).
var MAX_ENVIADOS = 400;

// ── Instalação / operação ────────────────────────────────────────────────

function crm_instalar() {
  var props = PropertiesService.getScriptProperties();
  var novo = false;
  if (!props.getProperty('CRM_TOKEN')) {
    props.setProperty('CRM_TOKEN', gerarToken_());
    novo = true;
  }
  crm_desinstalar();
  ScriptApp.newTrigger('crm_enviar')
    .forSpreadsheet(PLANILHA_ID)
    .onChange()
    .create();
  ScriptApp.newTrigger('crm_enviar').timeBased().everyMinutes(5).create();
  Logger.log('Gatilhos instalados: ao mudar a planilha + a cada 5 minutos.');
  if (novo) {
    Logger.log('');
    Logger.log('TOKEN GERADO — copie pro Railway (META_LEADS_PLANILHA_TOKEN):');
    Logger.log(props.getProperty('CRM_TOKEN'));
    Logger.log('');
    Logger.log('Depois de salvar no Railway, rode crm_enviar (ou espere 5 minutos).');
  } else {
    crm_enviar();
  }
  crm_status();
}

function crm_mostrar_token() {
  var token = PropertiesService.getScriptProperties().getProperty('CRM_TOKEN');
  Logger.log(token ? 'Token atual (META_LEADS_PLANILHA_TOKEN no Railway):\n' + token : 'Nenhum token ainda — rode crm_instalar.');
}

function crm_gerar_novo_token() {
  PropertiesService.getScriptProperties().setProperty('CRM_TOKEN', gerarToken_());
  Logger.log('Token trocado. Atualize META_LEADS_PLANILHA_TOKEN no Railway com:');
  crm_mostrar_token();
}

function crm_desinstalar() {
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'crm_enviar') {
      ScriptApp.deleteTrigger(t);
      removidos++;
    }
  });
  if (removidos > 0) Logger.log('Gatilhos removidos: ' + removidos);
}

function crm_status() {
  var gatilhos = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'crm_enviar';
  }).length;
  var props = PropertiesService.getScriptProperties();
  var enviados = lerEnviados_();
  var aba = null;
  try {
    aba = SpreadsheetApp.openById(PLANILHA_ID).getSheetByName(ABA);
  } catch (e) {
    Logger.log('ERRO ao abrir a planilha: ' + e);
  }
  Logger.log('Gatilhos ativos: ' + gatilhos + (gatilhos === 0 ? ' (rode crm_instalar)' : ''));
  Logger.log('Token: ' + (props.getProperty('CRM_TOKEN') ? 'definido' : 'AUSENTE (rode crm_instalar)'));
  Logger.log('Aba "' + ABA + '": ' + (aba ? 'encontrada, ' + (aba.getLastRow() - 1) + ' linha(s)' : 'NÃO ENCONTRADA — renomearam?'));
  Logger.log('Ids já enviados (lista local): ' + enviados.length);
  Logger.log('Último envio: ' + (props.getProperty('CRM_ULTIMO_ENVIO') || 'nunca'));
  Logger.log('Último erro: ' + (props.getProperty('CRM_ULTIMO_ERRO') || 'nenhum'));
}

function crm_reenviar_tudo() {
  PropertiesService.getScriptProperties().deleteProperty('CRM_ENVIADOS');
  Logger.log('Lista local esquecida — enviando a planilha inteira.');
  crm_enviar();
}

// ── Envio ────────────────────────────────────────────────────────────────

function crm_enviar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Outro envio em andamento — pulando esta rodada.');
    return;
  }
  var props = PropertiesService.getScriptProperties();
  try {
    var token = props.getProperty('CRM_TOKEN');
    if (!token) throw new Error('Token não definido — rode crm_instalar.');

    var aba = SpreadsheetApp.openById(PLANILHA_ID).getSheetByName(ABA);
    if (!aba) throw new Error('Aba "' + ABA + '" não encontrada na planilha.');

    var dados = aba.getDataRange().getValues();
    if (dados.length < 2) {
      Logger.log('Planilha sem linhas de lead.');
      return;
    }
    var cabecalho = dados[0].map(function (h) {
      return String(h).trim();
    });
    var idxId = cabecalho.indexOf('id');
    if (idxId === -1) throw new Error('Coluna "id" não encontrada na aba "' + ABA + '".');

    var enviados = lerEnviados_();
    var jaEnviado = {};
    enviados.forEach(function (id) {
      jaEnviado[id] = true;
    });

    var pendentes = [];
    for (var i = 1; i < dados.length; i++) {
      var linha = dados[i];
      var id = String(linha[idxId]).trim();
      if (!id || jaEnviado[id]) continue;
      var campos = {};
      for (var j = 0; j < cabecalho.length; j++) {
        if (!cabecalho[j]) continue;
        campos[cabecalho[j]] = celulaComoTexto_(linha[j]);
      }
      if (ehLeadDeTeste_(campos)) {
        enviados.push(id);
        continue;
      }
      pendentes.push({ id: id, campos: campos });
    }

    if (pendentes.length === 0) {
      gravarEnviados_(enviados);
      Logger.log('Nada novo pra enviar.');
      return;
    }

    var totalOk = 0;
    for (var inicio = 0; inicio < pendentes.length; inicio += LOTE) {
      var lote = pendentes.slice(inicio, inicio + LOTE);
      var resposta = UrlFetchApp.fetch(CRM_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ origem: 'planilha', linhas: lote }),
        muteHttpExceptions: true,
      });
      var codigo = resposta.getResponseCode();
      if (codigo !== 200) {
        var erro = 'CRM respondeu ' + codigo + ': ' + resposta.getContentText().slice(0, 300);
        props.setProperty('CRM_ULTIMO_ERRO', new Date().toISOString() + ' — ' + erro);
        Logger.log(erro + ' — as linhas deste lote ficam pra próxima rodada.');
        break;
      }
      lote.forEach(function (l) {
        enviados.push(l.id);
      });
      totalOk += lote.length;
      var corpo = JSON.parse(resposta.getContentText());
      (corpo.processados || []).forEach(function (p) {
        Logger.log('Lead ' + p.leadgenId + ': ' + p.resultado);
      });
    }

    gravarEnviados_(enviados);
    props.setProperty('CRM_ULTIMO_ENVIO', new Date().toISOString() + ' — ' + totalOk + ' linha(s)');
    Logger.log('Enviadas ' + totalOk + ' de ' + pendentes.length + ' linha(s) pendente(s).');
  } catch (e) {
    props.setProperty('CRM_ULTIMO_ERRO', new Date().toISOString() + ' — ' + e);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// ── Apoio ────────────────────────────────────────────────────────────────

function gerarToken_() {
  // 64 caracteres hexadecimais — mesmo tamanho do token gerado pelo CRM.
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function lerEnviados_() {
  var bruto = PropertiesService.getScriptProperties().getProperty('CRM_ENVIADOS');
  if (!bruto) return [];
  try {
    return JSON.parse(bruto);
  } catch (e) {
    return [];
  }
}

function gravarEnviados_(lista) {
  var unicos = [];
  var visto = {};
  for (var i = lista.length - 1; i >= 0; i--) {
    if (visto[lista[i]]) continue;
    visto[lista[i]] = true;
    unicos.unshift(lista[i]);
  }
  if (unicos.length > MAX_ENVIADOS) unicos = unicos.slice(unicos.length - MAX_ENVIADOS);
  PropertiesService.getScriptProperties().setProperty('CRM_ENVIADOS', JSON.stringify(unicos));
}

// Célula → texto. Data vira ISO; número vira dígitos (sem notação
// científica); o resto, String().
function celulaComoTexto_(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'number') {
    return Number.isInteger(valor) ? valor.toFixed(0) : String(valor);
  }
  return String(valor).trim();
}

// Lead de teste gerado pelo botão "Testar" do formulário no Meta — não vira
// lead no CRM (o CRM também filtra, por garantia).
function ehLeadDeTeste_(campos) {
  if (String(campos.email || '').toLowerCase() === 'test@meta.com') return true;
  for (var k in campos) {
    if (String(campos[k]).toLowerCase().indexOf('<test lead') !== -1) return true;
  }
  return false;
}
