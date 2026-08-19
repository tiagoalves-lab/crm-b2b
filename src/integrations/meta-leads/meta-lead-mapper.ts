import type { CreateRawLeadDto } from '../../raw-leads/dto/create-raw-lead.dto';
import {
  CAMPOS_PADRAO,
  NOMES_MAPEADOS,
  type MetaLeadDetail,
} from './meta-leads.types';

export interface LeadMapeado {
  rawLead: CreateRawLeadDto;
  // A pessoa que preencheu o formulário — vira Contact da company-lead
  // (mesmo padrão de RawLeadService#importSpreadsheetWithContacts). Só
  // preenchido quando dá pra identificar alguém de verdade: nome + ao
  // menos uma forma de contato. Sem isso, um formulário que só pede
  // "empresa" criaria contato fantasma sem como falar com ninguém.
  contato?: {
    nome: string;
    email?: string;
    telefone?: string;
    cargo?: string;
  };
  // Perguntas do formulário que o mapeador não conhece (ver dúvida 1.4 do
  // roadmap) — devolvidas só pra ficarem visíveis no resultado do
  // processamento/log; o dado em si nunca se perde porque a resposta
  // inteira do `GET /{leadgen_id}` é gravada em
  // `meta_leads_webhook_events.lead_payload`.
  camposNaoMapeados: string[];
}

// DE-PARA `field_data` (Meta) → `CreateRawLeadDto` (CRM). Equivalente ao
// DE-PARA de cabeçalhos do import por planilha
// (raw-leads/spreadsheet-import.util.ts), com a diferença de que aqui quem
// define o "cabeçalho" é o formulário montado no Meta Business Suite, não
// um template nosso — por isso o mapeamento é por lista de aliases
// conhecidos (CAMPOS_PADRAO) e tudo que sobra é reportado em vez de
// descartado em silêncio.
//
// Não normaliza caixa alta aqui de propósito: RawLeadService#create já
// centraliza isso pra TODA entrada de lead (form manual, planilha e agora
// Meta) — duplicar a regra aqui criaria um segundo lugar pra ela divergir.
export function mapearLeadDoMeta(
  lead: MetaLeadDetail,
  leadgenId: string,
): LeadMapeado {
  const respostas = indexarRespostas(lead);

  const nomeCompleto =
    primeiro(respostas, CAMPOS_PADRAO.nome) ??
    juntarNome(
      primeiro(respostas, CAMPOS_PADRAO.primeiroNome),
      primeiro(respostas, CAMPOS_PADRAO.sobrenome),
    );
  const empresa = primeiro(respostas, CAMPOS_PADRAO.empresa);
  const cargo = primeiro(respostas, CAMPOS_PADRAO.cargo);
  const email = primeiro(respostas, CAMPOS_PADRAO.email);
  const telefone = primeiro(respostas, CAMPOS_PADRAO.telefone);
  const cidade = primeiro(respostas, CAMPOS_PADRAO.cidade);
  const uf = normalizarUf(primeiro(respostas, CAMPOS_PADRAO.uf));
  const cnpj = normalizarDocumento(primeiro(respostas, CAMPOS_PADRAO.cnpj));

  // `razaoSocial` é obrigatório em RawLead. Ordem de preferência: nome da
  // empresa (é um CRM B2B — quando o formulário pergunta, é o mais útil),
  // senão o nome de quem preencheu, senão um rótulo com o id do lead pra
  // linha nunca nascer anônima e sempre dar pra rastrear na Central de
  // Leads.
  const razaoSocial = empresa ?? nomeCompleto ?? `LEAD META ${leadgenId}`;

  const rawLead: CreateRawLeadDto = {
    razaoSocial,
    fonte: 'meta_leads',
    cnpj,
    municipio: cidade,
    uf,
    emails: email ? [email] : undefined,
    fones: telefone ? [telefone] : undefined,
    // Marcador de origem na Prospecção — `fonte` já distingue no banco, mas
    // a lista de leads filtra por tag, não por `fonte`.
    tags: ['meta-leads'],
  };

  const contato =
    nomeCompleto && (email || telefone)
      ? { nome: nomeCompleto, email, telefone, cargo }
      : undefined;

  return { rawLead, contato, camposNaoMapeados: naoMapeados(respostas) };
}

// `field_data` é lista de `{ name, values: [] }` — só o primeiro valor não
// vazio interessa (campo de múltipla escolha manda vários, mas nenhum
// campo do DE-PARA atual é múltipla escolha).
function indexarRespostas(lead: MetaLeadDetail): Map<string, string> {
  const map = new Map<string, string>();
  for (const campo of lead.field_data ?? []) {
    const nome = typeof campo?.name === 'string' ? campo.name.trim() : '';
    if (!nome) continue;
    const valor = (campo.values ?? [])
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .find((v) => v.length > 0);
    if (!valor) continue;
    // Nome de campo customizado pode vir com maiúscula/acento do jeito que
    // o formulário foi escrito; a chave do índice é minúscula pra bater com
    // os aliases de CAMPOS_PADRAO sem depender disso.
    map.set(nome.toLowerCase(), valor);
  }
  return map;
}

function primeiro(
  respostas: Map<string, string>,
  aliases: readonly string[],
): string | undefined {
  for (const alias of aliases) {
    const valor = respostas.get(alias);
    if (valor) return valor;
  }
  return undefined;
}

function naoMapeados(respostas: Map<string, string>): string[] {
  return [...respostas.keys()].filter((nome) => !NOMES_MAPEADOS.has(nome));
}

function juntarNome(
  primeiroNome: string | undefined,
  sobrenome: string | undefined,
): string | undefined {
  const partes = [primeiroNome, sobrenome].filter(
    (p): p is string => !!p && p.length > 0,
  );
  return partes.length > 0 ? partes.join(' ') : undefined;
}

// `RawLead.uf`/`Company.uf` são CHAR(2) no banco — o campo "state" da Meta
// tanto pode vir como sigla ("SP") quanto por extenso ("São Paulo"),
// dependendo de como o formulário foi montado. Só aceita o que já é sigla;
// por extenso vira `undefined` (a cidade sozinha já situa o lead, e chutar
// a sigla a partir do nome seria adivinhação).
function normalizarUf(valor: string | undefined): string | undefined {
  const limpo = valor?.trim();
  return limpo && limpo.length === 2 ? limpo.toUpperCase() : undefined;
}

// Só dígitos, mesmo critério de RawLeadService#create — e só aceita
// comprimento de CPF (11) ou CNPJ (14): campo de texto livre num formulário
// vem com erro de digitação com frequência, e um documento truncado viraria
// dedupe errado (RawLeadService dedupe leads por CNPJ).
function normalizarDocumento(valor: string | undefined): string | undefined {
  const digitos = valor?.replace(/\D/g, '') ?? '';
  return digitos.length === 11 || digitos.length === 14 ? digitos : undefined;
}
