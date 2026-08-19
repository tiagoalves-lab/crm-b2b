import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EgestorContatoConsolidado, PessoaTipo } from '@prisma/client';
import { sanitizeRazaoSocial } from '../../common/sanitize-razao-social';
import type { TenantTx } from '../../tenancy/tenant-context.service';
import { extrairContatoArray } from './egestor.types';
import type { EgestorContatoRaw } from './egestor.types';

export interface PromoteSummary {
  promovidas: number;
  vinculadasExistente: number;
  criadasNovas: number;
  usandoDadosDivergentes: number;
  contatosCriados: number;
  erros: Array<{ cpfCnpj: string; motivo: string }>;
  // Ids das Companies criadas NESTA rodada — quem chama usa pra buscar o
  // Cartão CNPJ na Receita depois (fora da transação, ver
  // EgestorCartaoCnpjService). A promoção em si nunca faz essa consulta:
  // é chamada de rede, e aqui roda tudo dentro de uma tx só.
  companiesCriadasIds: string[];
  // Quantas fichas de empresa (Company) foram atualizadas com o cadastro
  // do eGestor nesta rodada — razão social, endereço, contato, e-mails/
  // telefones e dados estaduais (ver sincronizarCompanyComEgestor).
  fichasAtualizadas: number;
}

// Promove linhas da tabela espelho (`EgestorContatoConsolidado`) pra
// `Company` de verdade — decisões 1.11/1.13 (docs/roadmap.md):
// toda empresa do eGestor vira Company automaticamente como CLIENTE (tag
// "cliente", nunca "lead-triagem" — não passa pelo fluxo de aprovação de
// lead).
//
// **Decisão do usuário (2026-08-07)**: em caso de conflito
// (`ambos_diferentes`), **a Matriz é o registro determinante** — promove
// com os dados de `dadosMatriz`, nunca `dadosFilial`, quando os dois
// existem e divergem. Isso vale só pra decidir o que entra no CRM; a
// divergência em si (fazer a Filial bater com a Matriz de volta no
// eGestor) continua pendente pro relatório de auditoria/sanitização
// (S2.3, ainda não construído) — promover pra Company não fecha essa
// pendência, só para de bloquear a empresa de aparecer no CRM por causa
// dela.
@Injectable()
export class EgestorContatoPromoteService {
  async promoteClean(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<PromoteSummary> {
    // Não filtra mais por `companyId: null` — além de promover linha nova,
    // esta passada agora também faz o backfill do(s) Contato(s) (pessoa)
    // nas linhas já promovidas antes desse campo existir (achado
    // 2026-08-11: ~213 empresas promovidas ficaram com a aba "Contatos"
    // vazia, o dado de nomeParaContato/emails/fones do eGestor só ia pra
    // Company, nunca virava um Contact de verdade). Reprocessar todas as
    // linhas é barato (~300 no volume atual) e idempotente — ver
    // comentário mais abaixo, perto de `mapearContatosParaContact`, sobre
    // o critério (`ownerUserId`) que decide se é seguro reconstruir os
    // contatos da Company a cada rodada.
    const todasAsLinhas = await tx.egestorContatoConsolidado.findMany({
      where: { workspaceId },
    });

    const summary: PromoteSummary = {
      promovidas: 0,
      vinculadasExistente: 0,
      criadasNovas: 0,
      usandoDadosDivergentes: 0,
      contatosCriados: 0,
      erros: [],
      companiesCriadasIds: [],
      fichasAtualizadas: 0,
    };

    for (const row of todasAsLinhas) {
      await this.promoverLinha(tx, workspaceId, row, summary);
    }

    return summary;
  }

  // Promove UMA linha do espelho (já existente, com `dadosMatriz`/
  // `dadosFilial` atuais) — usada tanto pelo loop de `promoteClean` quanto
  // pelo processamento em tempo real do webhook (`EgestorWebhookProcessingService`,
  // 2026-08-12), que já resolveu/persistiu a linha antes de chamar isto.
  // Some erro nesta linha nunca derruba as outras (mesmo padrão de
  // `EgestorContatoSyncService#reconciliarOrfas`) — acumula em
  // `summary.erros` e segue.
  async promoverLinha(
    tx: TenantTx,
    workspaceId: string,
    row: EgestorContatoConsolidado,
    summary: PromoteSummary,
  ): Promise<void> {
    try {
      const fonte = (row.dadosMatriz ??
        row.dadosFilial) as EgestorContatoRaw | null;
      if (!fonte) {
        if (!row.companyId) {
          summary.erros.push({
            cpfCnpj: row.cpfCnpj,
            motivo: 'Sem dados em nenhum dos dois lados.',
          });
        }
        return;
      }

      let companyId = row.companyId;
      if (companyId) {
        // Já promovida numa rodada anterior — só falta garantir o
        // Contato (abaixo), não repete dedupe/criação de Company.
      } else {
        // Mesma function SECURITY DEFINER já usada em
        // CompanyService#create pra dedupe entre representantes — aqui
        // resolve dedupe entre o eGestor e uma Company já cadastrada
        // manualmente no CRM.
        const existente = await tx.$queryRaw<Array<{ id: string | null }>>(
          Prisma.sql`SELECT public.find_company_id_by_cnpj(${workspaceId}::uuid, ${row.cpfCnpj}) AS id`,
        );
        const existingId = existente[0]?.id;

        if (existingId) {
          // Nunca sobrescreve cadastro manual já existente (mesma
          // filosofia do merge entre representantes, 2026-08-06) — só
          // garante que ela conte como Cliente e, se era uma company de
          // Prospecção ainda não aprovada (tag "lead-triagem"), "graduar"
          // ela — o eGestor confirma que é cliente de verdade, não faz
          // sentido continuar escondida em triagem (mesmo GET /companies
          // que filtra por essa tag esconderia esta empresa mesmo já
          // marcada "cliente" — bug real achado promovendo as primeiras
          // 213 linhas em 2026-08-07, corrigido aqui).
          const atual = await tx.company.findUniqueOrThrow({
            where: { id: existingId },
            select: { tags: true },
          });
          const eraLeadTriagem = atual.tags.includes('lead-triagem');
          const tagsNovas = atual.tags.filter((t) => t !== 'lead-triagem');
          if (!tagsNovas.includes('cliente')) tagsNovas.push('cliente');
          if (tagsNovas.length !== atual.tags.length || eraLeadTriagem) {
            await tx.company.update({
              where: { id: existingId },
              data: { tags: tagsNovas },
            });
          }
          if (eraLeadTriagem) {
            // Mesmo efeito de RawLeadService#approve() (status →
            // aprovado), sem emitir Activity — decisão consciente pra
            // não gerar spam no feed do Painel numa promoção em lote.
            await tx.rawLead.updateMany({
              where: { promotedCompanyId: existingId, status: 'novo' },
              data: { status: 'aprovado' },
            });
          }
          companyId = existingId;
          summary.vinculadasExistente += 1;
        } else {
          const dados = mapearContatoParaCompany(fonte, row.cpfCnpj);
          const criada = await tx.company.create({
            data: { workspaceId, ...dados },
          });
          companyId = criada.id;
          summary.criadasNovas += 1;
          summary.companiesCriadasIds.push(criada.id);
        }

        await tx.egestorContatoConsolidado.update({
          where: { id: row.id },
          data: { companyId },
        });
        summary.promovidas += 1;
        if (row.status === 'ambos_diferentes')
          summary.usandoDadosDivergentes += 1;
      }

      // Backfill do(s) Contato(s) (pessoa) — roda pra linha nova e pra
      // linha já promovida antes (achado 2026-08-11, e ajuste
      // 2026-08-12: "Sul Brasil tinha vários e-mails no eGestor, no CRM
      // só apareceu um" — 1 Contact por item de `emails`/`fones`, não
      // mais um só juntando o primeiro de cada). `ownerUserId` é o
      // marcador de origem: só o backend grava `null` aqui —
      // ContactService#create sempre usa o `userId` de quem está
      // logado — então "todo Contact desta Company tem ownerUserId
      // null" quer dizer "nenhum representante mexeu nisso ainda",
      // seguro apagar e reconstruir do zero a cada rodada de promoção
      // pra refletir o dado mais recente do eGestor. Basta UM contato
      // com dono pra essa Company inteira ficar intocada (não dá pra
      // saber qual dos vários é o que o representante editou).
      const contatosAtuais = await tx.contact.findMany({
        where: { companyId },
        select: { id: true, ownerUserId: true },
      });
      const temContatoManual = contatosAtuais.some(
        (c) => c.ownerUserId !== null,
      );
      if (!temContatoManual) {
        const linhas = mapearContatosParaContact(fonte);
        if (contatosAtuais.length > 0) {
          await tx.contact.deleteMany({
            where: { id: { in: contatosAtuais.map((c) => c.id) } },
          });
        }
        for (const dadosContato of linhas) {
          await tx.contact.create({
            data: { workspaceId, companyId, ...dadosContato },
          });
          summary.contatosCriados += 1;
        }
      }

      // Ficha da empresa em dia com o eGestor — roda pra linha nova e pra
      // já promovida, igual ao backfill de Contato acima. Achado
      // 2026-08-19 (usuário lançou a inscrição estadual no eGestor e o
      // bloco "Dados estaduais" da ficha continuou em branco): o cadastro
      // do ERP só entrava na Company no momento da CRIAÇÃO; depois disso
      // o CRM nunca mais acompanhava. Ver sincronizarCompanyComEgestor
      // pras regras (ERP manda enquanto tiver valor; vazio nunca apaga).
      const camposAtualizados = await sincronizarCompanyComEgestor(
        tx,
        companyId,
        fonte,
      );
      if (camposAtualizados.length > 0) summary.fichasAtualizadas += 1;
    } catch (err) {
      summary.erros.push({
        cpfCnpj: row.cpfCnpj,
        motivo: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Terceira base das ações da tela Integração eGestor (card do Kanban
  // "Correção passa a gravar nas três bases — CRM, Matriz e Filial",
  // 2026-08-19): depois de Corrigir / Consolidar / Corrigir com SEFAZ /
  // Completar escreverem no ERP e atualizarem o espelho, a ficha da
  // empresa no CRM entra em dia com o mesmo valor. Sem isto, o webhook
  // disparado pela própria escrita volta como ECO (ignorado por
  // construção, senão o CRM reprocessaria a si mesmo) e a ficha ficava
  // parada no dado antigo.
  //
  // Recebe o id da LINHA do espelho já persistida — não o payload que
  // acabou de ir pro eGestor — pra ler exatamente o que ficou gravado, sem
  // reimplementar aqui a regra de qual lado vale.
  async sincronizarFichaDaLinha(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<string[]> {
    const row = await tx.egestorContatoConsolidado.findFirst({
      where: { id, workspaceId },
    });
    // Linha ainda não promovida (sem Company) não tem ficha pra atualizar
    // — o próximo "Promover contatos" cria com o dado já corrigido.
    if (!row?.companyId) return [];

    const fonte = (row.dadosMatriz ??
      row.dadosFilial) as EgestorContatoRaw | null;
    if (!fonte) return [];

    return sincronizarCompanyComEgestor(tx, row.companyId, fonte);
  }

  static novoSummaryVazio(): PromoteSummary {
    return {
      promovidas: 0,
      vinculadasExistente: 0,
      criadasNovas: 0,
      usandoDadosDivergentes: 0,
      contatosCriados: 0,
      erros: [],
      companiesCriadasIds: [],
      fichasAtualizadas: 0,
    };
  }
}

// Mapeamento de campo eGestor → Company, ver tabela em
// docs/api-egestor-contatos.md ("Mapeamento pra Company"). `ownerUserId`
// deliberadamente omitido (fica NULL) — sem mapeamento eGestor-vendedor
// → CRM-membership ainda (dúvida em aberto no plano), cada vendedor
// assume manualmente por enquanto.
function mapearContatoParaCompany(
  raw: EgestorContatoRaw,
  cpfCnpjDigits: string,
) {
  const nomeBruto = typeof raw.nome === 'string' ? raw.nome.trim() : '';
  let razaoSocial: string | undefined;
  let emRecuperacaoJudicial = false;
  if (nomeBruto) {
    const sanitizado = sanitizeRazaoSocial(nomeBruto);
    razaoSocial = sanitizado.razaoSocial;
    emRecuperacaoJudicial = sanitizado.emRecuperacaoJudicial;
  }

  const tipo: PessoaTipo = cpfCnpjDigits.length === 11 ? 'PF' : 'PJ';

  return {
    razaoSocial,
    emRecuperacaoJudicial,
    fantasia: strOrUndef(raw.fantasia),
    nomeParaContato: strOrUndef(raw.nomeParaContato),
    cpfCnpj: cpfCnpjDigits,
    tipo,
    dtNasc: parseDataEgestor(raw.dtNasc),
    dtCad: parseDataEgestor(raw.dtCad),
    emails: extrairContatoArray(raw.emails, ['email', 'valor', 'endereco']),
    fones: extrairContatoArray(raw.fones, [
      'fone',
      'telefone',
      'numero',
      'valor',
    ]),
    logradouro: strOrUndef(raw.logradouro),
    numero: strOrUndef(raw.numero),
    complemento: strOrUndef(raw.complemento),
    bairro: strOrUndef(raw.bairro),
    cep: strOrUndef(raw.cep),
    cidade: strOrUndef(raw.cidade),
    uf: strOrUndef(raw.uf)?.slice(0, 2),
    // Decisão 1.13: sempre Cliente, nunca "lead-triagem".
    tags: ['cliente'],
  };
}

interface ContatoParaCriar {
  nome: string;
  email?: string;
  telefone?: string;
  ownerUserId: null;
}

// Mapeamento de campo eGestor → Contact (pessoa), pro backfill da aba
// "Contatos" da ficha de empresa (achado 2026-08-11: `promoteClean` só
// criava/atualizava `Company` — o `nomeParaContato`/`emails`/`fones` do
// eGestor ficava só em campos da Company, a aba "Contatos" da ficha
// continuava sempre vazia).
//
// Ajuste 2026-08-12 (pedido do usuário: "Sul Brasil tem vários contatos
// de e-mail salvo, no CRM só tem um... aparecer todos os contatos mesmo
// que a linha possua campos vazios, só e-mail sem nome e telefone e
// vice-versa") — 1 Contact por item de `emails` + 1 Contact por item de
// `fones` (não mais 1 só juntando o primeiro de cada, que perdia os
// demais e-mails/telefones do eGestor). `nomeParaContato` (quando existe)
// vai só na PRIMEIRA linha gerada (prioridade e-mail sobre telefone) —
// eGestor não diz a qual e-mail/telefone o nome se refere, então não dá
// pra repetir com segurança em todas; as demais linhas ficam com
// `nome: ''` de propósito (aceito pelo usuário — "linha incompleta").
// `ownerUserId` fica `null` de propósito (mesmo critério do `ownerUserId`
// de Company no mapeamento acima) — também serve de MARCADOR de origem
// pro backfill em `promoteClean` (só o backend grava `null`; um
// representante criando manualmente sempre grava seu próprio userId).
// Devolve `[]` quando não há dado nenhum de contato (nem nome próprio,
// nem e-mail, nem telefone).
function mapearContatosParaContact(raw: EgestorContatoRaw): ContatoParaCriar[] {
  const emails = extrairContatoArray(raw.emails, [
    'email',
    'valor',
    'endereco',
  ]);
  const fones = extrairContatoArray(raw.fones, [
    'fone',
    'telefone',
    'numero',
    'valor',
  ]);
  const nomeContato = strOrUndef(raw.nomeParaContato);

  if (!nomeContato && emails.length === 0 && fones.length === 0) return [];

  const linhas: ContatoParaCriar[] = [];
  let nomeUsado = false;
  const proximoNome = () => {
    if (nomeUsado || !nomeContato) return '';
    nomeUsado = true;
    return nomeContato;
  };

  for (const email of emails) {
    linhas.push({ nome: proximoNome(), email, ownerUserId: null });
  }
  for (const telefone of fones) {
    linhas.push({ nome: proximoNome(), telefone, ownerUserId: null });
  }
  // Nome existe mas não coube em nenhuma linha acima (sem e-mail nem
  // telefone) — cria uma linha só com o nome.
  if (!nomeUsado && nomeContato) {
    linhas.push({ nome: nomeContato, ownerUserId: null });
  }

  return linhas;
}

// Dados estaduais (bloco "Dados estaduais (SEFAZ / ICMS)" da ficha da
// empresa) — `customFields.inscricao_estadual` e `customFields.indicador_ie`,
// os mesmos nomes que o formulário da ficha grava (updateCustomFieldsAction
// em web/) e que EgestorContatoCorrectionService lê quando o CRM é a
// origem da correção.
//
// Regra (card do Kanban "Campo fiscal: o CRM recebe do eGestor e guarda,
// mas nunca serve de origem para um campo que ele não tem"): o ERP manda
// enquanto tiver valor; eGestor vazio **nunca apaga** o que já está na
// ficha — o representante pode ter anotado a IE aqui antes de ela existir
// lá, e apagar seria perder dado real. Divergência real (os dois lados com
// valor diferente) resolve na tela Integração eGestor, como todas as
// outras.
export async function sincronizarCompanyComEgestor(
  tx: TenantTx,
  companyId: string,
  fonte: EgestorContatoRaw,
): Promise<string[]> {
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      razaoSocial: true,
      emRecuperacaoJudicial: true,
      fantasia: true,
      nomeParaContato: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      cep: true,
      cidade: true,
      uf: true,
      emails: true,
      fones: true,
      customFields: true,
    },
  });

  const alterados: string[] = [];
  const data: Record<string, unknown> = {};

  // Razão social passa pelo mesmo saneamento do cadastro manual — o
  // eGestor guarda o indicativo "EM RECUPERAÇÃO JUDICIAL" dentro do nome,
  // e no CRM ele é campo próprio (ver src/common/sanitize-razao-social.ts).
  const nomeBruto = strOrUndef(fonte.nome);
  if (nomeBruto) {
    const { razaoSocial, emRecuperacaoJudicial } =
      sanitizeRazaoSocial(nomeBruto);
    const nomeFinal = razaoSocial ? emCaixaAlta(razaoSocial) : undefined;
    if (nomeFinal && nomeFinal !== company.razaoSocial) {
      data.razaoSocial = nomeFinal;
      alterados.push('razão social');
    }
    if (emRecuperacaoJudicial !== company.emRecuperacaoJudicial) {
      data.emRecuperacaoJudicial = emRecuperacaoJudicial;
      alterados.push('recuperação judicial');
    }
  }

  const escalares: Array<[keyof typeof CAMPOS_ESCALARES, string]> =
    Object.entries(CAMPOS_ESCALARES) as never;
  for (const [campoCompany, rotulo] of escalares) {
    const novo = strOrUndef((fonte as Record<string, unknown>)[campoCompany]);
    if (!novo) continue; // eGestor sem valor nunca apaga o do CRM
    const atual = (company as Record<string, unknown>)[campoCompany];
    const valor =
      campoCompany === 'uf'
        ? emCaixaAlta(novo).slice(0, 2)
        : emCaixaAlta(novo);
    if (valor !== (atual ?? '')) {
      data[campoCompany] = valor;
      alterados.push(rotulo);
    }
  }

  // Listas (e-mails/telefones) seguem o mesmo cuidado da sanitização em
  // lote pelo cartão CNPJ: só grava quando não apaga nada — o CRM pode ter
  // o contato que o representante anotou e o ERP não conhece. Quando os
  // dois lados têm valores que o outro não tem, fica como está e a
  // divergência continua visível na tela Integração eGestor.
  const listas: Array<['emails' | 'fones', string, string[]]> = [
    [
      'emails',
      'e-mails',
      extrairContatoArray(fonte.emails, ['email', 'valor', 'endereco']),
    ],
    [
      'fones',
      'telefones',
      extrairContatoArray(fonte.fones, ['fone', 'telefone', 'numero', 'valor']),
    ],
  ];
  for (const [campo, rotulo, novos] of listas) {
    if (novos.length === 0) continue;
    const atuais = company[campo] ?? [];
    if (mesmoConjunto(atuais, novos)) continue;
    if (ehSubconjunto(atuais, novos)) {
      data[campo] = novos;
      alterados.push(rotulo);
    }
  }

  // Dados estaduais (SEFAZ/ICMS) — moram em customFields, ver
  // mapearDadosEstaduais.
  const estaduais = mapearDadosEstaduais(fonte);
  const customAtuais =
    (company.customFields as Record<string, unknown> | null) ?? {};
  const mudancasCustom: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(estaduais)) {
    // `customFields` é jsonb livre: o valor salvo pode ser texto ou número
    // (o indicador de IE já foi gravado das duas formas ao longo do
    // tempo). Qualquer outro tipo conta como "não preenchido".
    const atual = customAtuais[chave];
    const atualTexto =
      typeof atual === 'string' || typeof atual === 'number'
        ? String(atual)
        : null;
    if (atualTexto !== valor) mudancasCustom[chave] = valor;
  }
  if (Object.keys(mudancasCustom).length > 0) {
    // `customFields` é jsonb livre no schema; o tipo gerado pelo Prisma
    // exige InputJsonValue, e o que veio do banco é `JsonValue`.
    data.customFields = {
      ...customAtuais,
      ...mudancasCustom,
    };
    if (mudancasCustom.inscricao_estadual) alterados.push('inscrição estadual');
    if (mudancasCustom.indicador_ie) alterados.push('indicador de IE');
  }

  if (alterados.length === 0) return [];

  await tx.company.update({ where: { id: companyId }, data });
  return alterados;
}

// Cadastro do CRM é todo em CAIXA ALTA (decisão do usuário, 2026-08-10 —
// mesma regra de RawLeadService#upperCaseTextFields e da query retroativa
// scripts/uppercase-cadastros-prospeccao.sql). O eGestor mistura os dois
// estilos ("Araranguá" na cidade, "RUA X" no logradouro), então o que
// entra por aqui é padronizado na porta de entrada, senão a lista de
// Empresas volta a ficar com metade dos nomes em caixa mista.
//
// Não gera divergência artificial com o ERP: toda comparação do módulo
// (normalizarParaComparacao, em EgestorContatoCorrectionService) já ignora
// caixa, então o CRM nunca vai reescrever o eGestor só por causa disto.
function emCaixaAlta(valor: string): string {
  return valor.toUpperCase();
}

// Campo em Company (mesmo nome no payload do eGestor) → rótulo em
// português pro histórico da tela Integração eGestor.
const CAMPOS_ESCALARES = {
  fantasia: 'nome fantasia',
  nomeParaContato: 'nome para contato',
  logradouro: 'logradouro',
  numero: 'número',
  complemento: 'complemento',
  bairro: 'bairro',
  cep: 'CEP',
  cidade: 'cidade',
  uf: 'UF',
} as const;

function mesmoConjunto(a: string[], b: string[]): boolean {
  return a.length === b.length && ehSubconjunto(a, b) && ehSubconjunto(b, a);
}

function ehSubconjunto(a: string[], b: string[]): boolean {
  const setB = new Set(b.map((v) => v.trim().toLowerCase()));
  return a.every((v) => setB.has(v.trim().toLowerCase()));
}

// Só 1/2/9 entram (enum da doc: 1 = Contribuinte, 2 = Isento, 9 = Não
// contribuinte) — mesmo critério de `sanitizarIndicadorIE` no serviço de
// correção. Qualquer outra coisa (o `0` que a API às vezes devolve e a
// doc registra como inválido, texto solto) fica de fora: melhor "Não
// informado" na ficha do que um indicador inventado, que voltaria pro ERP
// na próxima propagação.
function mapearDadosEstaduais(raw: EgestorContatoRaw): Record<string, string> {
  const dados: Record<string, string> = {};

  const inscricao = strOrUndef(
    (raw as Record<string, unknown>).inscricaoEstadual,
  );
  if (inscricao) dados.inscricao_estadual = inscricao;

  const indicador = strOrUndef((raw as Record<string, unknown>).indicadorIE);
  if (indicador === '1' || indicador === '2' || indicador === '9') {
    dados.indicador_ie = indicador;
  }

  return dados;
}

// O payload do eGestor é jsonb cru: o mesmo campo às vezes vem como texto,
// às vezes como número (`indicadorIE`). Só esses dois tipos viram valor de
// campo escalar — objeto/array aqui é dado de outro formato (ex.: a lista
// de e-mails), que tem tratamento próprio em extrairContatoArray.
function strOrUndef(valor: unknown): string | undefined {
  if (typeof valor !== 'string' && typeof valor !== 'number') return undefined;
  const texto = String(valor).trim();
  return texto ? texto : undefined;
}

// eGestor manda datas como "2025-06-11" ou "2025-06-11 14:49:57" (espaço,
// não "T") — `new Date()` do V8 aceita os dois formatos. Campo vazio
// ("", null, undefined) vira `undefined` (Prisma ignora, não grava nada).
function parseDataEgestor(valor: unknown): Date | undefined {
  if (typeof valor !== 'string' || !valor.trim()) return undefined;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? undefined : data;
}
