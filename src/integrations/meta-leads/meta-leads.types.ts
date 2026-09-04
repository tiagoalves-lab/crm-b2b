// Tipos compartilhados do módulo de integração com a Central de Leads do
// Meta Business Suite (Lead Ads Facebook/Instagram). Ver
// docs/webhook-meta-leads.md e docs/roadmap.md, seção "Implementar
// integração com Central de Leads do Portfólio Meta da Gama".

// Corpo do `value` de cada mudança do webhook `leadgen` — a Meta manda só
// identificadores, nunca as respostas do formulário (elas vêm de um
// segundo request, ver MetaGraphService#buscarLead).
//
// Os ids chegam como NÚMERO JSON, não string (confirmado na doc oficial,
// 2026-08-14: `"leadgen_id": 123123123123` sem aspas) — daí o
// `string | number` e o `String(...)` em quem consome: id de negócio nunca
// deve virar aritmética. Ids do Facebook têm ~15-16 dígitos, dentro do
// limite de inteiro seguro do JS (9.007e15), então `JSON.parse` não perde
// precisão hoje; se a Meta passar a emitir id maior que isso, o valor
// chegaria corrompido antes de qualquer código nosso rodar — nesse caso o
// caminho seria parsear o corpo cru com reviver, não ajustar aqui.
export interface MetaLeadgenChangeValue {
  leadgen_id: string | number;
  page_id: string | number;
  form_id?: string | number;
  ad_id?: string | number;
  adgroup_id?: string | number;
  // Epoch em SEGUNDOS (não milissegundos) — ver parseCreatedTime.
  created_time?: number;
}

// Resposta do `GET /{leadgen_id}` — o dado de verdade do lead. `field_data`
// é uma lista de pares pergunta/resposta cujo `name` depende de como o
// formulário foi montado no Meta Business Suite: os campos padrão têm nome
// fixo (ver CAMPOS_PADRAO abaixo), perguntas customizadas têm o nome que
// quem montou o formulário escolheu.
export interface MetaLeadDetail {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: Array<{ name?: string; values?: unknown[] }>;
}

// Nomes de campo padrão dos formulários de Lead Ads da Meta — os únicos
// que dá pra mapear com segurança enquanto a lista real dos formulários da
// Gama não for levantada (docs/roadmap.md, dúvida 1.4). Cada chave aponta
// pros aliases que a Meta usa pro mesmo dado (`full_name` vs
// `first_name`+`last_name`, `phone_number` vs `phone`, etc.).
//
// A lista de campos "pré-preenchíveis" da Meta (conferida na doc oficial,
// 2026-08-14) é maior que esta: inclui também endereço, CEP, país, data de
// nascimento, gênero e estado civil. Ficam de fora de propósito — não há
// campo correspondente em RawLead/Company pra eles hoje, e inventar
// mapeamento pra dado que ninguém pediu só cria coluna errada. Continuam
// preservados em `meta_leads_webhook_events.lead_payload`.
export const CAMPOS_PADRAO = {
  nome: ['full_name', 'name', 'nome', 'nome_completo'],
  primeiroNome: ['first_name', 'primeiro_nome'],
  sobrenome: ['last_name', 'sobrenome'],
  email: ['email', 'e_mail', 'work_email'],
  telefone: ['phone_number', 'phone', 'telefone', 'work_phone_number'],
  empresa: ['company_name', 'company', 'empresa', 'nome_da_empresa'],
  cargo: ['job_title', 'cargo', 'funcao'],
  cidade: ['city', 'cidade'],
  uf: ['state', 'estado', 'uf'],
  // A pergunta de CNPJ do formulário da Gama chega com o texto inteiro
  // como nome do campo (levantado na planilha, 2026-09-04). Além dos
  // aliases, o mapeador aceita qualquer campo cujo nome contenha "cnpj".
  cnpj: ['cnpj', 'qual_o_cnpj_da_sua_empresa?', 'cnpj_da_empresa'],
} as const;

// Colunas da planilha do gestor de tráfego (export da Central de Leads)
// que são metadado do anúncio/da captura, não resposta do formulário. O
// MetaLeadsPlanilhaService deixa essas de fora do `field_data` que monta —
// senão cada uma viraria "pergunta customizada" e iria parar na anotação
// da Timeline do lead.
export const COLUNAS_METADADOS_PLANILHA = new Set<string>([
  'id',
  'created_time',
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'form_id',
  'form_name',
  'is_organic',
  'platform',
  'lead_status',
]);

// Todos os nomes já cobertos pelo mapeador — o que sobra é pergunta
// customizada (a Meta devolve a pergunta com o TEXTO dela como `name`,
// confirmado na doc oficial em 2026-08-14 — por isso o índice de respostas
// é montado em minúsculas, senão "Qual produto?" nunca casaria com alias
// nenhum). Pergunta customizada vira anotação na Timeline do lead
// (decisão do usuário, 2026-09-04, ver MetaLeadsWebhookService) e segue
// preservada em `meta_leads_webhook_events.lead_payload`.
export const NOMES_MAPEADOS = new Set<string>(
  Object.values(CAMPOS_PADRAO).flat(),
);

// A Meta manda epoch em segundos; `new Date(n)` interpreta milissegundos —
// sem a multiplicação, todo evento cairia em 1970.
export function parseCreatedTime(
  createdTime: number | undefined,
): Date | undefined {
  if (typeof createdTime !== 'number' || !Number.isFinite(createdTime)) {
    return undefined;
  }
  const parsed = new Date(createdTime * 1000);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
