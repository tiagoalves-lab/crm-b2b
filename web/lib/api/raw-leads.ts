import { apiFetch, ApiError } from "./client";
import type { Company, LeadFonte, PaginatedResult, RawLead, RawLeadStatus } from "./types";

export type ScoreTier = "quente" | "morno" | "frio";

// Espelha LeadScoringService#tier no backend (src/raw-leads/lead-scoring.service.ts)
// — só pra exibição (o score em si já vem calculado do backend).
export function scoreTier(score: number): ScoreTier {
  if (score >= 70) return "quente";
  if (score >= 45) return "morno";
  return "frio";
}

// Espelha LeadScoringService#score no backend — só o texto explicativo
// (score.reasons), pra exibir o tooltip "ⓘ" e a aba "Dados do lead"
// (SPEC-CRM-GAMA.md §4.4, protótipo: score-why/kv "Cálculo"). O `score`
// em si é sempre o valor persistido no backend, nunca recalculado aqui —
// isto só reconstitui o *porquê* a partir dos mesmos campos que o
// backend usou, sem chamada extra à API.
export function scoreReasons(lead: Pick<RawLead, "cnaePrincipal" | "importador" | "porte" | "situacao" | "uf">): string[] {
  const reasons: string[] = [];

  const div = parseInt((lead.cnaePrincipal ?? "").slice(0, 2), 10);
  if (div >= 25 && div <= 30) reasons.push("CNAE alvo (25–30) +40");
  else if (div === 24) reasons.push("CNAE metalurgia próxima +20");
  else reasons.push("CNAE fora do alvo +0");

  reasons.push(lead.importador ? "Importa via Comex Stat +25" : "Não importa +0");

  if (lead.porte === "GRANDE") reasons.push("Porte grande +20");
  else if (lead.porte === "MÉDIO") reasons.push("Porte médio +13");
  else reasons.push("Porte pequeno +5");

  reasons.push(lead.situacao === "ATIVA" ? "Situação ativa +10" : "Situação irregular −20");

  if (lead.uf === "RS") reasons.push("Região RS +5");

  return reasons;
}

export function listRawLeads(
  token: string,
  options: { status?: RawLeadStatus; tier?: ScoreTier; q?: string; pageSize?: number } = {},
): Promise<PaginatedResult<RawLead>> {
  const query = new URLSearchParams({ pageSize: String(options.pageSize ?? 200) });
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

export function rescoreLeads(token: string): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>("/raw-leads/rescore", {
    method: "POST",
    token,
  });
}

export interface ImportResult {
  total: number;
  imported: number;
  errors: Array<{ row: number; reason: string }>;
}

// Fora do padrão apiFetch (JSON-only) de propósito: multipart precisa que
// o próprio fetch monte o Content-Type com boundary — se a gente setar
// manualmente, o multer do backend não consegue parsear o arquivo.
export async function importRawLeadsSpreadsheet(
  token: string,
  file: File,
): Promise<ImportResult> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new Error("NEXT_PUBLIC_API_URL não configurada.");
  }

  const body = new FormData();
  body.append("file", file, file.name);

  const res = await fetch(`${apiUrl}/raw-leads/import`, {
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
