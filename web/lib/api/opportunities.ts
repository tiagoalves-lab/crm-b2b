import { apiFetch } from "./client";
import type { Opportunity, OpportunityStatus, PaginatedResult } from "./types";

export function listOpportunities(token: string): Promise<PaginatedResult<Opportunity>> {
  return apiFetch<PaginatedResult<Opportunity>>("/opportunities?pageSize=100", {
    token,
  });
}

export interface CreateOpportunityInput {
  companyId: string;
  pipelineId: string;
  stageId: string;
  amount: number;
  currency: string;
  primaryContactId?: string;
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
