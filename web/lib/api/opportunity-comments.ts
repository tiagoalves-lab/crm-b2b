// Chat de comentários do card de Oportunidade (feature nova, fora do
// SPEC-CRM-GAMA.md original) — mirror da metade de comentário de
// task-cards.ts. `tags` (2026-09-04): itens da oportunidade carimbados no
// comentário; o backend recusa tag que não esteja na lista do card.
import { apiFetch } from "./client";
import type { OpportunityComment } from "./types";

export function createComment(
  token: string,
  opportunityId: string,
  body: string,
  tags: string[] = [],
): Promise<OpportunityComment> {
  return apiFetch<OpportunityComment>(`/opportunities/${opportunityId}/comments`, {
    method: "POST",
    token,
    body: tags.length > 0 ? { body, tags } : { body },
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
