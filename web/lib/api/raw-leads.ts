import { apiFetch } from "./client";
import type { Company } from "./types";

// Aprova o lead na hora (SPEC-CRM-GAMA.md §4.2.1, caminho 2 do seletor de
// empresa) — devolve a company já sem a tag "lead-triagem".
export function approveLead(token: string, id: string): Promise<Company> {
  return apiFetch<Company>(`/raw-leads/${id}/approve`, {
    method: "POST",
    token,
  });
}
