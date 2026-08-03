import { apiFetch } from "./client";
import type { Opportunity, OpportunityStatus, OpportunityWithDetails, PaginatedResult } from "./types";

export function listOpportunities(
  token: string,
  options: { companyId?: string } = {},
): Promise<PaginatedResult<Opportunity>> {
  const query = new URLSearchParams({ pageSize: "100" });
  if (options.companyId) query.set("companyId", options.companyId);
  return apiFetch<PaginatedResult<Opportunity>>(`/opportunities?${query.toString()}`, {
    token,
  });
}

export function getOpportunity(token: string, id: string): Promise<OpportunityWithDetails> {
  return apiFetch<OpportunityWithDetails>(`/opportunities/${id}`, { token });
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
  status?: OpportunityStatus;
  lostReason?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: string;
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
