import { apiFetch } from "./client";
import type { Activity, PaginatedResult } from "./types";

export function listActivities(
  token: string,
  target: { companyId: string } | { opportunityId: string },
): Promise<PaginatedResult<Activity>> {
  const query = new URLSearchParams({ pageSize: "100" });
  if ("companyId" in target) query.set("companyId", target.companyId);
  else query.set("opportunityId", target.opportunityId);
  return apiFetch<PaginatedResult<Activity>>(`/activities?${query.toString()}`, {
    token,
  });
}

export interface CreateActivityInput {
  companyId?: string;
  opportunityId?: string;
  type: "note" | "call" | "email";
  texto: string;
  subtipo?: string;
}

export function createActivity(
  token: string,
  input: CreateActivityInput,
): Promise<Activity> {
  return apiFetch<Activity>("/activities", { method: "POST", token, body: input });
}
