import type { CreateRawLeadDto } from '../../raw-leads/dto/create-raw-lead.dto';
import {
  CAMPOS_PADRAO,
  NOMES_MAPEADOS,
  type MetaLeadDetail,
} from './meta-leads.types';

// Tag que todo lead vindo do Meta recebe na Prospecção (pedido direto do
// usuário, 2026-09-04: "esses registros devem ir automaticamente com uma
// tag Meta Business"). É por ela que a lista de leads filtra — `fonte`
// distingue no banco, mas a tela filtra por tag.
export const TAG_META_BUSINESS = 'Meta Business';

// Pergunta própria do formulário (fora do DE-PARA) com a resposta — já
// legíveis (ver `legivel` abaixo). Vira anotação na Timeline do lead.
export interface RespostaNaoMapeada {
  // Nome do campo como a Meta manda (chave do `field_data`, em minúsculas)
  // — só pra log/diagnóstico.
  campo: string;
  pergunta: string;
  resposta: string;
}

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
  // Perguntas do formulário que o mapeador não conhece (as 3 do formulário
  // da Gama: equipamento procurado, prazo de compra, já usa máquina do
  // tipo). Decisão do usuário (2026-09-04): entram como anotação na
  // Timeline do lead (ver MetaLeadsWebhookService#criarLeadNoCrm) — o
  // vendedor precisa ler isso antes de ligar. O dado cru continua também
  // em `meta_leads_webhook_events.lead_payload`.
  respostasNaoMapeadas: RespostaNaoMapeada[];
}

// DE-PARA `field_data` (Meta) → `CreateRawLeadDto` (CRM). Equivalente ao
// DE-PARA de cabeçalhos do import por planilha
// (raw-leads/spreadsheet-import.util.ts), com a diferença de que aqui quem
// define o "cabeçalho" é o formulário montado no Meta Business Suite, não
// um template nosso — por isso o mapeamento é por lista de aliases
// conhecidos (CAMPOS_PADRAO) e tudo que sobra é devolvido como resposta
// não mapeada em vez de descartado em silêncio.
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
  const chaveCnpj = chaveDoCnpj(respostas);
  const cnpj = normalizarDocumento(
    chaveCnpj ? respostas.get(chaveCnpj) : undefined,
  );

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
    tags: [TAG_META_BUSINESS],
  };

  const contato =
    nomeCompleto && (email || telefone)
      ? { nome: nomeCompleto, email, telefone, cargo }
      : undefined;

  return {
    rawLead,
    contato,
    respostasNaoMapeadas: naoMapeados(respostas, chaveCnpj),
  };
}

// A Meta troca espaço por "_" no nome de pergunta customizada e nas opções
// de múltipla escolha ("máquina_de_corte_a_laser_para_chapas",
// "sim,_queremos_ampliar_ou_substituir"). Só desfaz isso quando o texto
// não tem espaço nenhum — texto livre digitado pela pessoa (que tem
// espaço) fica como veio, senão um "_" legítimo sumiria.
export function legivel(texto: string): string {
  const limpo = texto.includes(' ') ? texto : texto.replace(/_/g, ' ');
  return limpo.replace(/\s+/g, ' ').trim();
}

function perguntaLegivel(campo: string): string {
  const texto = legivel(campo);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
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

// Alias conhecido primeiro; senão, qualquer campo cujo nome contenha "cnpj"
// — a pergunta é escrita à mão no Meta Business Suite ("Qual o CNPJ da sua
// empresa?") e o texto pode mudar de formulário pra formulário.
function chaveDoCnpj(respostas: Map<string, string>): string | undefined {
  for (const alias of CAMPOS_PADRAO.cnpj) {
    if (respostas.get(alias)) return alias;
  }
  return [...respostas.keys()].find((nome) => nome.includes('cnpj'));
}

function naoMapeados(
  respostas: Map<string, string>,
  chaveCnpj: string | undefined,
): RespostaNaoMapeada[] {
  return [...respostas.entries()]
    .filter(([nome]) => !NOMES_MAPEADOS.has(nome) && nome !== chaveCnpj)
    .map(([campo, resposta]) => ({
      campo,
      pergunta: perguntaLegivel(campo),
      resposta: legivel(resposta),
    }));
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
//
// 12–13 dígitos viram CNPJ completando zero à esquerda (10 → CPF): a
// planilha do Google guarda um CNPJ digitado só com números como NÚMERO,
// e número não tem zero à esquerda — "01.234.567/0001-89" sem a máscara
// chega como 1234567000189. Erro de digitação de verdade nessa faixa é
// raro o bastante pra valer o resgate.
function normalizarDocumento(valor: string | undefined): string | undefined {
  const digitos = valor?.replace(/\D/g, '') ?? '';
  if (digitos.length === 11 || digitos.length === 14) return digitos;
  if (digitos.length === 12 || digitos.length === 13) {
    return digitos.padStart(14, '0');
  }
  if (digitos.length === 10) return digitos.padStart(11, '0');
  return undefined;
}
