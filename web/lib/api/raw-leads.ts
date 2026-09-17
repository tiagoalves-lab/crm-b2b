import { apiFetch, ApiError } from "./client";
import type { Company, LeadFonte, PaginatedResult, RawLead, RawLeadStatus } from "./types";

export type ScoreTier = "quente" | "morno" | "frio";

// Rótulo de exibição dos tiers (pedido do usuário, 2026-09-01): a UI fala
// em prazo de abordagem — Curto/Médio/Longo Prazo — em vez de
// Quente/Morno/Frio. Só troca o texto na tela; o valor interno
// ("quente"/"morno"/"frio") continua o mesmo no banco, na API e na URL.
export const TIER_LABEL: Record<ScoreTier, string> = {
  quente: "Curto Prazo",
  morno: "Médio Prazo",
  frio: "Longo Prazo",
};

// Classificação do lead: só a manual (pedido do usuário, 2026-09-14 — o
// score automático saiu da interface inteira, "não vamos usar isso"). Um
// lead sem classificação devolve null; antes caía numa faixa calculada a
// partir do score, o que fazia todo lead nascer classificado sozinho.
export function effectiveTier(lead: Pick<RawLead, "manualTier">): ScoreTier | null {
  return lead.manualTier ?? null;
}

// 5000 (não 200): a tela de Prospecção busca tudo numa página só e
// filtra/ordena no client, sem paginação de verdade (mesmo padrão de
// approvedLeads/descartadosItems) — um teto baixo aqui faz lead de score
// baixo "sumir" da tela mesmo existindo no banco (achado real, 2026-08-10:
// reimportar planilha sem CNAE/porte gerou centenas de leads "frios" que
// nunca apareciam por causa desse corte). Espelha o @Max(5000) do
// ListRawLeadsQueryDto no backend.
const DEFAULT_PAGE_SIZE = 5000;

export function listRawLeads(
  token: string,
  options: { status?: RawLeadStatus; tier?: ScoreTier; q?: string; pageSize?: number } = {},
): Promise<PaginatedResult<RawLead>> {
  const query = new URLSearchParams({ pageSize: String(options.pageSize ?? DEFAULT_PAGE_SIZE) });
  if (options.status) query.set("status", options.status);
  if (options.tier) query.set("tier", options.tier);
  if (options.q) query.set("q", options.q);
  return apiFetch<PaginatedResult<RawLead>>(`/raw-leads?${query.toString()}`, {
    token,
  });
}

export function getRawLead(token: string, id: string): Promise<RawLead> {
  return apiFetch<RawLead>(`/raw-leads/${id}`, { token });
}

export interface CreateRawLeadInput {
  razaoSocial: string;
  // Advisory — mesmo campo/motivo de CreateCompanyInput#emRecuperacaoJudicial.
  emRecuperacaoJudicial?: boolean;
  cnpj?: string;
  cnaePrincipal?: string;
  cnaeDescricao?: string;
  porte?: string;
  uf?: string;
  municipio?: string;
  situacao?: string;
  importador?: boolean;
  fonte?: LeadFonte;
}

export function createRawLead(
  token: string,
  input: CreateRawLeadInput,
): Promise<RawLead> {
  return apiFetch<RawLead>("/raw-leads", { method: "POST", token, body: input });
}

// Aprova o lead na hora (SPEC-CRM-GAMA.md §4.2.1, caminho 2 do seletor de
// empresa) — devolve a company já sem a tag "lead-triagem".
export function approveLead(token: string, id: string): Promise<Company> {
  return apiFetch<Company>(`/raw-leads/${id}/approve`, {
    method: "POST",
    token,
  });
}

export function discardLead(token: string, id: string): Promise<RawLead> {
  return apiFetch<RawLead>(`/raw-leads/${id}/discard`, {
    method: "POST",
    token,
  });
}

// Classificação do lead (Curto/Médio/Longo Prazo) — tier: null deixa o
// lead sem classificação.
export function updateLeadTier(
  token: string,
  id: string,
  tier: ScoreTier | null,
): Promise<RawLead> {
  return apiFetch<RawLead>(`/raw-leads/${id}/tier`, {
    method: "PATCH",
    token,
    body: { tier },
  });
}

// Tags livres da Prospecção — substitui o conjunto inteiro (o cliente
// sempre manda o array completo desejado, mesmo contrato de
// updateLeadTier acima).
export function updateLeadTags(
  token: string,
  id: string,
  tags: string[],
): Promise<RawLead> {
  return apiFetch<RawLead>(`/raw-leads/${id}/tags`, {
    method: "PATCH",
    token,
    body: { tags },
  });
}

// Segmento de negócio — valor único (null limpa), diferente de
// updateLeadTags acima (array).
export function updateLeadSegmento(
  token: string,
  id: string,
  segmento: string | null,
): Promise<RawLead> {
  return apiFetch<RawLead>(`/raw-leads/${id}/segmento`, {
    method: "PATCH",
    token,
    body: { segmento },
  });
}

// Completar o cadastro de um lead em triagem (CNPJ + dados da Receita) —
// todo campo opcional, o que não vier fica como está; `cnpj: null` limpa.
// Espelha UpdateLeadCadastroDto no backend.
export interface UpdateLeadCadastroInput {
  cnpj?: string | null;
  razaoSocial?: string;
  emRecuperacaoJudicial?: boolean;
  cnaePrincipal?: string;
  cnaeDescricao?: string;
  porte?: string;
  uf?: string;
  municipio?: string;
  situacao?: string;
}

export function updateLeadCadastro(
  token: string,
  id: string,
  input: UpdateLeadCadastroInput,
): Promise<RawLead> {
  return apiFetch<RawLead>(`/raw-leads/${id}/cadastro`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export interface BulkResult {
  ok: string[];
  failed: Array<{ id: string; reason: string }>;
}

export function bulkApproveLeads(token: string, ids: string[]): Promise<BulkResult> {
  return apiFetch<BulkResult>("/raw-leads/bulk-approve", {
    method: "POST",
    token,
    body: { ids },
  });
}

export function bulkDiscardLeads(token: string, ids: string[]): Promise<BulkResult> {
  return apiFetch<BulkResult>("/raw-leads/bulk-discard", {
    method: "POST",
    token,
    body: { ids },
  });
}

export interface ImportResult {
  total: number;
  imported: number;
  errors: Array<{ row: number; reason: string }>;
}

// Modelo padrão FIXO com múltiplos contatos por empresa (linha se repete
// pelo mesmo CNPJ, uma linha = um contato) — ver
// src/raw-leads/contacts-spreadsheet-import.util.ts no backend, que rejeita
// (400) qualquer cabeçalho fora do template.
export const CONTACTS_TEMPLATE_HEADERS = [
  "CNPJ",
  "Razão Social",
  "Fantasia",
  "Cidade",
  "UF",
  "CNAE",
  "Porte",
  "Situação Cadastral",
  "Abertura",
  "Sócios (QSA)",
  "Importador",
  // Tags livres da Prospecção (2026-08-06, pedido direto do usuário —
  // não existia neste modelo) — mesmo separador "|" de Sócios (QSA).
  "Tags",
  "Contato Nome",
  "Contato Cargo",
  "Contato Email",
  "Contato Telefone",
  "Contato Decisor",
] as const;

export async function importRawLeadsWithContactsSpreadsheet(
  token: string,
  file: File,
): Promise<ImportResult> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new Error("NEXT_PUBLIC_API_URL não configurada.");
  }

  const body = new FormData();
  body.append("file", file, file.name);

  const res = await fetch(`${apiUrl}/raw-leads/import-contacts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type");
  const data: unknown = contentType?.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data as ImportResult;
}
