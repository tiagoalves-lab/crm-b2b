import { apiFetch } from "./client";
import type { Company, LeadFonte, PaginatedResult, RawLead, RawLeadStatus } from "./types";

export type ScoreTier = "quente" | "morno" | "frio";

// Espelha LeadScoringService#tier no backend (src/raw-leads/lead-scoring.service.ts)
// — só pra exibição (o score em si já vem calculado do backend).
export function scoreTier(score: number): ScoreTier {
  if (score >= 70) return "quente";
  if (score >= 45) return "morno";
  return "frio";
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
