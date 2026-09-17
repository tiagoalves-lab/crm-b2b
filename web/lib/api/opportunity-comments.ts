// Chat de comentários do card de Oportunidade (feature nova, fora do
// SPEC-CRM-GAMA.md original) — mirror da metade de comentário de
// task-cards.ts. `tags` (2026-09-04): itens da oportunidade carimbados no
// comentário; o backend recusa tag que não esteja na lista do card.
import { apiFetch } from "./client";
import type { OpportunityComment, OpportunityCommentFeedItem } from "./types";

export function createComment(
  token: string,
  opportunityId: string,
  body: string,
  tags: string[] = [],
  // Membros destacados (2026-09-14) — cada um ganha pendência no card.
  mentions: string[] = [],
): Promise<OpportunityComment> {
  return apiFetch<OpportunityComment>(`/opportunities/${opportunityId}/comments`, {
    method: "POST",
    token,
    body: {
      body,
      ...(tags.length > 0 ? { tags } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
    },
  });
}

// Destacar/tirar destaque de membros num comentário já publicado — a
// lista vai inteira e substitui a anterior.
export function setCommentMentions(
  token: string,
  opportunityId: string,
  commentId: string,
  mentions: string[],
): Promise<OpportunityComment> {
  return apiFetch<OpportunityComment>(
    `/opportunities/${opportunityId}/comments/${commentId}/destaques`,
    { method: "PATCH", token, body: { mentions } },
  );
}

// Baixa (ou reabertura) da pendência de quem foi destacado no comentário
// — só o próprio destacado pode.
export function setMentionDone(
  token: string,
  opportunityId: string,
  commentId: string,
  resolvida: boolean,
): Promise<OpportunityComment> {
  return apiFetch<OpportunityComment>(
    `/opportunities/${opportunityId}/comments/${commentId}/pendencia`,
    { method: "PATCH", token, body: { resolvida } },
  );
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

// Fixar/desafixar (2026-09-09): comentário fixado abre no topo do
// histórico de anotações do Pipeline.
export function setCommentPinned(
  token: string,
  opportunityId: string,
  commentId: string,
  pinned: boolean,
): Promise<OpportunityComment> {
  return apiFetch<OpportunityComment>(
    `/opportunities/${opportunityId}/comments/${commentId}/pin`,
    { method: "PATCH", token, body: { pinned } },
  );
}

// Histórico de anotações de todos os cards visíveis (2026-09-09) — os
// fixados vêm inteiros, o resto é a janela dos mais recentes.
export function listCommentFeed(
  token: string,
  options: { apenasFixados?: boolean } = {},
): Promise<{ items: OpportunityCommentFeedItem[] }> {
  const query = options.apenasFixados ? "?apenasFixados=1" : "";
  return apiFetch<{ items: OpportunityCommentFeedItem[] }>(
    `/opportunity-comments${query}`,
    { token },
  );
}

// Marcar como lido / não lido no histórico de anotações (2026-09-17).
export function setCommentRead(
  token: string,
  commentId: string,
  lido: boolean,
): Promise<{ id: string; lido: boolean }> {
  return apiFetch<{ id: string; lido: boolean }>(
    `/opportunity-comments/${commentId}/lido`,
    { method: "PATCH", token, body: { lido } },
  );
}

// "Marcar tudo como lido" — todas as anotações que a pessoa enxerga.
export function markAllCommentsRead(token: string): Promise<{ marcadas: number }> {
  return apiFetch<{ marcadas: number }>(`/opportunity-comments/lido`, {
    method: "POST",
    token,
  });
}

// Quantas anotações estão fixadas (2026-09-14) — a barra da tela
// Pipeline mostra o número ao lado do ícone de histórico. Nunca derruba
// a tela: se a chamada falhar, devolve null e o aviso simplesmente não
// aparece.
export async function contarComentariosFixados(token: string): Promise<number | null> {
  try {
    const { items } = await listCommentFeed(token, { apenasFixados: true });
    return items.length;
  } catch {
    return null;
  }
}
