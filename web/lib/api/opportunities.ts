import { apiFetch } from "./client";
import type { Opportunity, OpportunityStatus, OpportunityWithDetails, PaginatedResult } from "./types";

export function listOpportunities(
  token: string,
  options: { companyId?: string; status?: OpportunityStatus } = {},
): Promise<PaginatedResult<Opportunity>> {
  // 1000 (não 100): a tela Pipeline separa abertas/ganhas/perdidas no
  // cliente, então um teto baixo corta as encerradas mais antigas — o
  // histórico de cotações de 2025 (123 oportunidades) estourou o 100 e as
  // encerradas do mês escolhido sumiam. Espelha o @Max(5000) do
  // ListOpportunitiesQueryDto no backend.
  const query = new URLSearchParams({ pageSize: "1000" });
  if (options.companyId) query.set("companyId", options.companyId);
  if (options.status) query.set("status", options.status);
  return apiFetch<PaginatedResult<Opportunity>>(`/opportunities?${query.toString()}`, {
    token,
  });
}

export function getOpportunity(token: string, id: string): Promise<OpportunityWithDetails> {
  return apiFetch<OpportunityWithDetails>(`/opportunities/${id}`, { token });
}

// Ordem dos cards dentro de uma coluna do quadro (2026-09-14) — a coluna
// inteira, na ordem em que ficou depois do arrasto.
export function reorderOpportunities(
  token: string,
  stageId: string,
  orderedIds: string[],
): Promise<void> {
  return apiFetch<void>("/opportunities/reorder", {
    method: "POST",
    token,
    body: { stageId, orderedIds },
  });
}

export function deleteOpportunity(token: string, id: string): Promise<Opportunity> {
  return apiFetch<Opportunity>(`/opportunities/${id}`, { method: "DELETE", token });
}

export interface CreateOpportunityInput {
  companyId: string;
  pipelineId: string;
  stageId: string;
  amount: number;
  currency: string;
  expectedCloseDate?: string;
  // Detalhamento livre (2026-09-04).
  description?: string;
  // Lista lateral de itens digitada já no cadastro (2026-09-04).
  items?: string[];
}

export function createOpportunity(
  token: string,
  input: CreateOpportunityInput,
): Promise<Opportunity> {
  return apiFetch<Opportunity>("/opportunities", {
    method: "POST",
    token,
    body: input,
  });
}

export interface UpdateOpportunityInput {
  version: number;
  stageId?: string;
  pipelineId?: string;
  // Representante da oportunidade (2026-09-04) — precisa ser membro ativo
  // do workspace, checado no backend.
  ownerUserId?: string;
  status?: OpportunityStatus;
  lostReason?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: string;
  // Detalhamento livre (2026-09-04) — string vazia limpa o campo.
  description?: string;
  // Tratamento do SLA ao voltar de Negociação para proposta (2026-09-16).
  slaTratamento?: "erro_elaboracao" | "alteracao_cliente";
  // Stand by (2026-10-22): true exige expectedCloseDate nova; false retoma.
  standby?: boolean;
}

export function updateOpportunity(
  token: string,
  id: string,
  input: UpdateOpportunityInput,
): Promise<Opportunity> {
  return apiFetch<Opportunity>(`/opportunities/${id}`, {
    method: "PATCH",
    token,
    body: input,
  });
}
