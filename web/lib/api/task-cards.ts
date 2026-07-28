// Checklist e comentários — sub-recursos do cartão de tarefa (rota
// aninhada /tasks/:taskId/...), agrupados aqui separado de tasks.ts pra
// não misturar CRUD de Task com CRUD dos sub-recursos do cartão.
import { apiFetch } from "./client";
import type { TaskChecklistItem, TaskComment } from "./types";

export function createChecklistItem(
  token: string,
  taskId: string,
  text: string,
): Promise<TaskChecklistItem> {
  return apiFetch<TaskChecklistItem>(`/tasks/${taskId}/checklist-items`, {
    method: "POST",
    token,
    body: { text },
  });
}

export interface UpdateChecklistItemInput {
  text?: string;
  done?: boolean;
  position?: number;
}

export function updateChecklistItem(
  token: string,
  taskId: string,
  itemId: string,
  input: UpdateChecklistItemInput,
): Promise<TaskChecklistItem> {
  return apiFetch<TaskChecklistItem>(
    `/tasks/${taskId}/checklist-items/${itemId}`,
    { method: "PATCH", token, body: input },
  );
}

export function deleteChecklistItem(
  token: string,
  taskId: string,
  itemId: string,
): Promise<void> {
  return apiFetch<void>(`/tasks/${taskId}/checklist-items/${itemId}`, {
    method: "DELETE",
    token,
  });
}

export function createComment(
  token: string,
  taskId: string,
  body: string,
): Promise<TaskComment> {
  return apiFetch<TaskComment>(`/tasks/${taskId}/comments`, {
    method: "POST",
    token,
    body: { body },
  });
}

export function deleteComment(
  token: string,
  taskId: string,
  commentId: string,
): Promise<void> {
  return apiFetch<void>(`/tasks/${taskId}/comments/${commentId}`, {
    method: "DELETE",
    token,
  });
}
