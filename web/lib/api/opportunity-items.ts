// Lista lateral de itens do card de Oportunidade (2026-09-04) — ver
// src/opportunities/opportunity-item.service.ts. A lista em si vem
// embutida em GET /opportunities/:id (OpportunityWithDetails.items).
import { apiFetch } from "./client";
import type { OpportunityItem } from "./types";

export function createItem(token: string, opportunityId: string, name: string): Promise<OpportunityItem> {
  return apiFetch<OpportunityItem>(`/opportunities/${opportunityId}/items`, {
    method: "POST",
    token,
    body: { name },
  });
}

// Editar item (2026-09-04) — na prática, digitar o valor depois de
// montar a lista. `amount: null` limpa o valor.
export function updateItem(
  token: string,
  opportunityId: string,
  itemId: string,
  input: { name?: string; amount?: number | null },
): Promise<OpportunityItem> {
  return apiFetch<OpportunityItem>(`/opportunities/${opportunityId}/items/${itemId}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteItem(token: string, opportunityId: string, itemId: string): Promise<void> {
  return apiFetch<void>(`/opportunities/${opportunityId}/items/${itemId}`, {
    method: "DELETE",
    token,
  });
}
