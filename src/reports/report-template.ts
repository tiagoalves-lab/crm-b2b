import { moedaBR } from './report-datas';
import type {
  DadosFollowup,
  DadosReportDiario,
  TarefaPendente,
} from './report.types';

// Corpo do e-mail do resumo diário — layout aprovado pelo usuário em
// 2026-09-15 (pipeline em TABELA, com Nr na sequência do quadro).
//
// Regras de HTML de e-mail, que explicam por que este arquivo não se
// parece com o resto do frontend do projeto:
//
// • Estilo INLINE em cada elemento. Gmail/Outlook descartam ou reescrevem
//   folha de estilo; classe CSS não sobrevive ao caminho até a caixa.
// • Layout em <table>, não em flex/grid — o Outlook desktop renderiza com
//   o motor do Word, que não conhece nenhum dos dois. Aqui isso nem é
//   sacrifício: a seção principal é mesmo uma tabela.
// • Fonte do sistema, sem fonte da web: provedor de e-mail bloqueia
//   @font-face na maioria dos clientes.
// • Nada de imagem remota (a maioria dos clientes bloqueia por padrão e o
//   resumo ficaria ilegível) nem de JavaScript (removido sempre).
//
// As cores são as do CRM (web/app/globals.css) e as quatro cores de etapa
// são a mesma legenda usada no quadro do Pipeline.

const COR = {
  texto: '#1a1e24',
  secundario: '#5b6472',
  fraco: '#838c99',
  linha: '#dde1e7',
  linhaSuave: '#e7eaee',
  fundo: '#e8eaee',
  superficie: '#ffffff',
  afundado: '#f4f5f7',
  accent: '#052df4',
  alerta: '#c8402f',
} as const;

// Uma cor por etapa, na ordem do quadro — as MESMAS do quadro do Pipeline
// (web/app/dashboard/pipeline/stage-colors.ts: lilás, azul, verde,
// laranja, coral). Pedido do usuário (2026-09-15): e-mail e CRM tinham legendas
// diferentes pra mesma etapa. `forte` é a cor exata do quadro (barra da
// linha, número, contorno do prazo); `texto` é a mesma cor rebaixada só
// o necessário pra ler nome de etapa em 11,5px sobre fundo branco (o verde
// e o laranja do quadro, pensados pra bolinha e borda, não se leem como
// texto); `suave` é o fundo do selo de prazo. Cicla se algum dia o
// pipeline tiver mais etapas do que cores.
const CORES_ETAPA = [
  { forte: '#9b7fe0', texto: '#6f4fc0', suave: '#f1ecfb' },
  { forte: '#4a9fe0', texto: '#1f77b8', suave: '#eaf4fc' },
  { forte: '#5dcaa5', texto: '#2a8b6b', suave: '#e9f6f1' },
  // Propostas aprovadas (2026-10-28), entre Aprovação e Negociação.
  { forte: '#7cb342', texto: '#4f7a22', suave: '#eef6e5' },
  { forte: '#f2a71b', texto: '#a9740a', suave: '#fdf3e0' },
  // Fechamento (2026-10-22), última etapa do quadro.
  { forte: '#e5735f', texto: '#b4462f', suave: '#fcece8' },
];

// Largura do corpo do e-mail (pedido do usuário, 2026-09-15: "orientação
// paisagem, aproveitar melhor a largura"). 940px é o ponto em que a tabela
// do pipeline para de quebrar o nome das máquinas em quatro linhas e ainda
// cabe no painel de leitura de um monitor comum. Acima disso, cliente de
// e-mail começa a rolar de lado. Em tela estreita a tabela encolhe sozinha
// (`width: 100%`).
const LARGURA = 940;

const FONTE =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const FONTE_MONO = "'SF Mono', Consolas, 'Courier New', monospace";

function corEtapa(ordem: number) {
  const indice = (Math.max(1, ordem) - 1) % CORES_ETAPA.length;
  return CORES_ETAPA[indice];
}

// Conteúdo vindo do banco (nome de empresa, texto de anotação, título de
// tarefa) é escapado sempre: um "<" digitado por alguém não pode virar
// marcação no e-mail de todo mundo.
export function esc(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Assunto: só data e dia da semana (pedido do usuário, 2026-09-15 — antes
// trazia valor em aberto e tarefas atrasadas). Os números continuam no
// cabeçalho do e-mail; o assunto ficou sendo só o rótulo do dia.
export function assuntoReportDiario(dados: DadosReportDiario): string {
  return `Resumo do dia — ${dados.diaCurto} · ${dados.diaSemana}`;
}

function cabecalhoSecao(titulo: string, direita: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 14px 0;">
      <tr>
        <td style="font-family: ${FONTE}; font-size: 11px; font-weight: bold; letter-spacing: 0.09em; text-transform: uppercase; color: ${COR.texto};">${esc(titulo)}</td>
        <td align="right" style="font-family: ${FONTE}; font-size: 12px; color: ${COR.fraco}; white-space: nowrap;">${esc(direita)}</td>
      </tr>
    </table>`;
}

// A tabela do pipeline serve os dois reports (resumo diário e follow-up
// das cotações) — por isso pede só o recorte, não o objeto inteiro.
type DadosDaTabela = Pick<
  DadosReportDiario,
  'pipeline' | 'totalOportunidades' | 'totalEmAberto' | 'semValorDefinido'
>;

function secaoPipeline(dados: DadosDaTabela, titulo = 'Pipeline de oportunidades'): string {
  if (dados.pipeline.length === 0) {
    return secao(
      cabecalhoSecao(titulo, 'nenhuma aberta') +
        vazio('Nenhuma oportunidade aberta no quadro.'),
    );
  }

  const th = (texto: string, alinhamento = 'left') =>
    `<th align="${alinhamento}" style="font-family: ${FONTE}; font-size: 9.5px; font-weight: bold; letter-spacing: 0.07em; text-transform: uppercase; color: ${COR.fraco}; white-space: nowrap; padding: 0 8px 7px 8px; border-bottom: 1px solid ${COR.linha};">${texto}</th>`;

  const linhas = dados.pipeline
    .map((linha) => {
      const cor = corEtapa(linha.etapaOrdem);
      const td = (
        conteudo: string,
        estiloExtra = '',
      ) => `<td style="font-family: ${FONTE}; font-size: 11.5px; line-height: 1.35; color: ${COR.texto}; padding: 6px 8px; border-bottom: 1px solid ${COR.linhaSuave}; vertical-align: top; ${estiloExtra}">${conteudo}</td>`;

      return `
      <tr>
        <td align="right" style="font-family: ${FONTE_MONO}; font-size: 10.5px; font-weight: bold; color: ${cor.texto}; padding: 7px 8px 6px 8px; border-bottom: 1px solid ${COR.linhaSuave}; border-left: 2px solid ${cor.forte}; vertical-align: top;">${linha.nr}</td>
        ${td(esc(linha.abertura), `color: ${COR.secundario}; white-space: nowrap;`)}
        ${td(
          linha.fechamentoPrevisto ? esc(linha.fechamentoPrevisto) : '—',
          `color: ${linha.fechamentoPrevisto ? COR.secundario : COR.fraco}; white-space: nowrap;`,
        )}
        ${td(esc(linha.empresa), 'font-weight: bold; font-size: 12px;')}
        ${td(esc(linha.representante), `color: ${COR.secundario};`)}
        ${td(esc(linha.etapa), `color: ${cor.texto}; font-weight: bold;`)}
        ${td(
          `<span style="font-family: ${FONTE_MONO}; font-size: 10px; font-weight: bold; color: ${cor.texto}; background: ${cor.suave}; border: 1px solid ${cor.forte}; border-radius: 999px; padding: 1px 6px; white-space: nowrap;">${linha.slaDias === null ? '—' : `${linha.slaDias}d`}</span>`,
          'white-space: nowrap;',
        )}
        ${td(
          linha.itens.length > 0 ? esc(linha.itens.join(' · ')) : '—',
          // Menor que o resto da linha (pedido do usuário, 2026-09-15):
          // nome de máquina é longo e é o que estica a altura da linha.
          `color: ${COR.secundario}; font-size: 10px; line-height: 1.3;`,
        )}
      </tr>`;
    })
    .join('');

  const restantes = dados.totalOportunidades - dados.pipeline.length;
  const rodapeCorte =
    restantes > 0
      ? `<tr><td colspan="8" style="font-family: ${FONTE}; font-size: 11px; color: ${COR.fraco}; padding: 10px 8px 0 8px;">e mais ${restantes} ${restantes === 1 ? 'oportunidade aberta' : 'oportunidades abertas'} no quadro.</td></tr>`
      : '';

  const detalheSemValor =
    dados.semValorDefinido > 0
      ? ` <span style="color: ${COR.fraco};">· ${dados.semValorDefinido} sem valor definido</span>`
      : '';

  return secao(`
    ${cabecalhoSecao(
      titulo,
      `${dados.totalOportunidades} ${dados.totalOportunidades === 1 ? 'aberta' : 'abertas'} · ${moedaBR(dados.totalEmAberto)}`,
    )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      <tr>
        ${th('Nr', 'right')}
        ${th('Abertura')}
        ${th('Fech. prev.')}
        ${th('Empresa')}
        ${th('Representante')}
        ${th('Status')}
        ${th('SLA')}
        ${th('Itens')}
      </tr>
      ${linhas}
      ${rodapeCorte}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 16px; border-top: 1px solid ${COR.linhaSuave};">
      <tr>
        <td style="font-family: ${FONTE}; font-size: 13.5px; color: ${COR.secundario}; padding-top: 13px;">Total em aberto${detalheSemValor}</td>
        <td align="right" style="font-family: ${FONTE}; font-size: 16px; font-weight: bold; color: ${COR.texto}; padding-top: 13px; white-space: nowrap;">${moedaBR(dados.totalEmAberto)}</td>
      </tr>
    </table>`);
}

function secaoFixadas(dados: DadosReportDiario): string {
  if (dados.fixadas.length === 0) {
    return secao(
      cabecalhoSecao('Comentários fixados', 'nenhum') +
        vazio('Nenhum comentário fixado nos cards do Pipeline.'),
    );
  }

  const blocos = dados.fixadas
    .map(
      (fixada) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px; background: ${COR.afundado}; border-left: 3px solid ${COR.accent};">
        <tr>
          <td style="padding: 11px 14px;">
            <div style="font-family: ${FONTE}; font-size: 13px; font-weight: bold; color: ${COR.texto}; margin-bottom: 5px;">${esc(fixada.empresa)}</div>
            <div style="font-family: ${FONTE}; font-size: 13px; line-height: 1.55; color: #2f3742; margin-bottom: 7px; white-space: pre-line;">${esc(fixada.texto)}</div>
            <div style="font-family: ${FONTE}; font-size: 11.5px; color: ${COR.fraco};">${esc(fixada.autor)}${fixada.fixadoEm ? ` · fixado em ${esc(fixada.fixadoEm)}` : ''}</div>
          </td>
        </tr>
      </table>`,
    )
    .join('');

  return secao(
    cabecalhoSecao(
      'Comentários fixados',
      `${dados.fixadas.length} ${dados.fixadas.length === 1 ? 'ativo' : 'ativos'}`,
    ) + blocos,
  );
}

function grupoTarefas(
  titulo: string,
  cor: string,
  tarefas: TarefaPendente[],
): string {
  if (tarefas.length === 0) return '';

  const linhas = tarefas
    .map(
      (tarefa) => `
      <tr>
        <td style="padding: 0 8px 9px 0; vertical-align: top;">
          <div style="font-family: ${FONTE}; font-size: 13.5px; line-height: 1.4; color: ${COR.texto};">${esc(tarefa.titulo)}</div>
          <div style="font-family: ${FONTE}; font-size: 11.5px; color: ${COR.fraco}; margin-top: 2px;">${esc(
            [tarefa.empresa, tarefa.responsavel].filter(Boolean).join(' · '),
          )}</div>
        </td>
        <td align="right" style="font-family: ${FONTE}; font-size: 12px; color: ${cor}; white-space: nowrap; padding: 0 0 9px 8px; vertical-align: top;">${esc(tarefa.quando)}</td>
      </tr>`,
    )
    .join('');

  return `
    <div style="font-family: ${FONTE}; font-size: 11.5px; font-weight: bold; color: ${cor}; margin: 0 0 8px 0;">${esc(titulo)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 8px;">${linhas}</table>`;
}

// Recorte W0/W+1 (pedido do usuário, 2026-10-22): atrasadas, desta semana
// e da próxima. O que fica de fora (sem prazo ou mais adiante) não some em
// silêncio — vira uma linha de aviso no fim.
function secaoTarefas(dados: DadosReportDiario): string {
  if (dados.totalTarefasPendentes === 0) {
    return secao(
      cabecalhoSecao('Tarefas pendentes', 'nenhuma') +
        vazio('Nenhuma tarefa pendente.'),
    );
  }

  const nota = (texto: string) =>
    `<div style="font-family: ${FONTE}; font-size: 12px; color: ${COR.fraco}; margin-top: 10px;">${esc(texto)}</div>`;

  const cortadas = dados.tarefasNoRecorte - dados.tarefas.length;
  const foraDoRecorte = dados.totalTarefasPendentes - dados.tarefasNoRecorte;
  const rodape =
    (cortadas > 0
      ? nota(`e mais ${cortadas} ${cortadas === 1 ? 'tarefa' : 'tarefas'} neste período, no CRM.`)
      : '') +
    (foraDoRecorte > 0
      ? nota(
          `${foraDoRecorte} ${foraDoRecorte === 1 ? 'outra pendente tem' : 'outras pendentes têm'} prazo depois de ${dados.tarefasRecorteAte} ou estão sem prazo.`,
        )
      : '');

  // Nada de "no total" aqui: tradução automática leu o "no" como inglês e
  // o e-mail de 2026-10-22 chegou com "68 sem total".
  const cabecalho = cabecalhoSecao(
    'Tarefas pendentes',
    `${dados.tarefasNoRecorte} de ${dados.totalTarefasPendentes} pendentes`,
  );

  if (dados.tarefas.length === 0) {
    return secao(
      cabecalho +
        vazio('Nenhuma tarefa atrasada nem com prazo nesta semana ou na próxima.') +
        rodape,
    );
  }

  return secao(
    cabecalho +
      grupoTarefas(
        'Atrasadas',
        COR.alerta,
        dados.tarefas.filter((t) => t.grupo === 'atrasada'),
      ) +
      grupoTarefas(
        'Esta semana',
        '#186c3c',
        dados.tarefas.filter((t) => t.grupo === 'semana'),
      ) +
      grupoTarefas(
        'Próxima semana',
        COR.secundario,
        dados.tarefas.filter((t) => t.grupo === 'proxima-semana'),
      ) +
      rodape,
  );
}

function vazio(texto: string): string {
  return `<div style="font-family: ${FONTE}; font-size: 13px; color: ${COR.fraco};">${esc(texto)}</div>`;
}

function secao(conteudo: string): string {
  return `
    <tr>
      <td style="padding: 22px 24px; border-bottom: 1px solid ${COR.linhaSuave};">${conteudo}</td>
    </tr>`;
}

export function montarReportDiarioHtml(dados: DadosReportDiario): string {
  const figura = (valor: string, rotulo: string, cor: string = COR.texto) =>
    `<td style="padding-right: 28px; white-space: nowrap;"><span style="font-family: ${FONTE}; font-size: 15px; font-weight: bold; color: ${cor};">${esc(valor)}</span> <span style="font-family: ${FONTE}; font-size: 13px; color: ${COR.secundario};">${esc(rotulo)}</span></td>`;

  const botao = dados.appUrl
    ? `<a href="${esc(dados.appUrl)}" style="display: inline-block; background: ${COR.accent}; color: #ffffff; text-decoration: none; font-family: ${FONTE}; font-size: 13.5px; font-weight: bold; padding: 10px 20px; border-radius: 6px;">Abrir o CRM</a>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(assuntoReportDiario(dados))}</title>
</head>
<body style="margin: 0; padding: 0; background: ${COR.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${COR.fundo};">
  <tr>
    <td align="center" style="padding: 24px 12px 32px 12px;">
      <table role="presentation" width="${LARGURA}" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: ${LARGURA}px; background: ${COR.superficie}; border: 1px solid ${COR.linha};">

        <tr>
          <td style="padding: 20px 24px 18px 24px; border-top: 3px solid ${COR.accent}; border-bottom: 1px solid ${COR.linhaSuave};">
            <div style="font-family: ${FONTE}; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase; color: ${COR.accent}; margin-bottom: 10px;">Gama Brasil · CRM</div>
            <div style="font-family: ${FONTE}; font-size: 20px; font-weight: bold; color: ${COR.texto};">Resumo do dia</div>
            <div style="font-family: ${FONTE}; font-size: 13px; color: ${COR.secundario}; margin: 3px 0 16px 0;">${esc(dados.dataExtenso)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${figura(moedaBR(dados.totalEmAberto), 'em aberto')}
                ${figura(String(dados.totalOportunidades), 'oportunidades')}
                ${figura(String(dados.tarefasAtrasadas), dados.tarefasAtrasadas === 1 ? 'tarefa atrasada' : 'tarefas atrasadas', dados.tarefasAtrasadas > 0 ? COR.alerta : COR.texto)}
              </tr>
            </table>
          </td>
        </tr>

        ${secaoPipeline(dados)}
        ${secaoFixadas(dados)}
        ${secaoTarefas(dados)}

        <tr>
          <td style="padding: 22px 24px 24px 24px;">
            ${botao}
            <div style="font-family: ${FONTE}; font-size: 11.5px; line-height: 1.6; color: ${COR.fraco}; margin-top: ${botao ? '14px' : '0'};">Você recebe este resumo porque faz parte da equipe de gestão da Gama Brasil. Envio automático às 8h, de segunda a sexta. Para falar com alguém, é só responder este e-mail.</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Follow-up das cotações (2026-09-15) — quatro vezes por dia útil, só as
// etapas de proposta. Mesmo envelope e mesma tabela do resumo diário: quem
// lê os dois não precisa aprender dois layouts. O que muda é o recorte
// (três etapas) e o cabeçalho, que
// destaca o tempo de espera em vez do valor.
// ─────────────────────────────────────────────────────────────────────────

export function assuntoFollowup(dados: DadosFollowup): string {
  const quantidade =
    dados.totalOportunidades === 1
      ? '1 cotação'
      : `${dados.totalOportunidades} cotações`;
  return `Follow-up de cotações — ${dados.diaCurto} · ${dados.horario} · ${quantidade}`;
}

export function montarFollowupHtml(dados: DadosFollowup): string {
  const figura = (valor: string, rotulo: string, cor: string = COR.texto) =>
    `<td style="padding-right: 28px; white-space: nowrap;"><span style="font-family: ${FONTE}; font-size: 15px; font-weight: bold; color: ${cor};">${esc(valor)}</span> <span style="font-family: ${FONTE}; font-size: 13px; color: ${COR.secundario};">${esc(rotulo)}</span></td>`;

  const botao = dados.appUrl
    ? `<a href="${esc(dados.appUrl)}/dashboard/pipeline" style="display: inline-block; background: ${COR.accent}; color: #ffffff; text-decoration: none; font-family: ${FONTE}; font-size: 13.5px; font-weight: bold; padding: 10px 20px; border-radius: 6px;">Abrir o Pipeline</a>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(assuntoFollowup(dados))}</title>
</head>
<body style="margin: 0; padding: 0; background: ${COR.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${COR.fundo};">
  <tr>
    <td align="center" style="padding: 24px 12px 32px 12px;">
      <table role="presentation" width="${LARGURA}" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: ${LARGURA}px; background: ${COR.superficie}; border: 1px solid ${COR.linha};">

        <tr>
          <td style="padding: 20px 24px 18px 24px; border-top: 3px solid ${COR.accent}; border-bottom: 1px solid ${COR.linhaSuave};">
            <div style="font-family: ${FONTE}; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase; color: ${COR.accent}; margin-bottom: 10px;">Gama Brasil · CRM</div>
            <div style="font-family: ${FONTE}; font-size: 20px; font-weight: bold; color: ${COR.texto};">Follow-up de cotações</div>
            <div style="font-family: ${FONTE}; font-size: 13px; color: ${COR.secundario}; margin: 3px 0 16px 0;">${esc(dados.dataExtenso)} · ${esc(dados.horario)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${figura(String(dados.totalOportunidades), dados.totalOportunidades === 1 ? 'cotação em aberto' : 'cotações em aberto')}
                ${figura(moedaBR(dados.totalEmAberto), 'em negociação')}
                ${figura(`${dados.maiorSla}d`, 'a mais antiga', dados.maiorSla > 0 ? COR.alerta : COR.texto)}
              </tr>
            </table>
          </td>
        </tr>

        ${secaoPipeline(dados, 'Cotações em andamento')}

        <tr>
          <td style="padding: 22px 24px 24px 24px;">
            ${botao}
            <div style="font-family: ${FONTE}; font-size: 11.5px; line-height: 1.6; color: ${COR.fraco}; margin-top: ${botao ? '14px' : '0'};">Lista ordenada pelo tempo de espera: a cotação parada há mais tempo aparece primeiro. Acompanha as etapas ${esc(dados.etapasAcompanhadas.join(', '))}. Envio automático em dias úteis. Para falar com alguém, é só responder este e-mail.</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
