// Chat de comentários do card de Oportunidade (feature nova, fora do
// SPEC-CRM-GAMA.md original) — mirror da metade de comentário de
// task-cards.ts.
import { apiFetch } from "./client";
import type { OpportunityComment } from "./types";

export function createComment(
  token: string,
  opportunityId: string,
  body: string,
): Promise<OpportunityComment> {
  return apiFetch<OpportunityComment>(`/opportunities/${opportunityId}/comments`, {
    method: "POST",
    token,
    body: { body },
  });
}

export function deleteComment(
  token: string,
  opportunityId: string,
  commentId: string,
): Promise<void> {
  return apiFetch<void>(`/opportunities/${opportunityId}/comments/${commentId}`, {
    method: "DELETE",
    token,
  });
}
