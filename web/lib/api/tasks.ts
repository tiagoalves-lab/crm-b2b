import { apiFetch } from "./client";
import type { PaginatedResult, Task, TaskStatus, TaskType, TaskWithDetails } from "./types";

// 5 tipos de openTaskForm() no protótipo (gama-crm-mvp.html) + "reuniao"
// adicionado depois (pedido do usuário, 2026-08-04).
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  ligacao: "Ligação",
  email: "E-mail",
  visita: "Visita",
  proposta: "Proposta",
  followup: "Follow-up",
  reuniao: "Reunião",
};

export function taskTypeLabel(tipo: TaskType | null): string {
  return tipo ? TASK_TYPE_LABELS[tipo] : "—";
}

// Tarefas desses tipos exigem selecionar um contato da empresa vinculada
// (pedido do usuário, 2026-08-04; "email" incluído depois, mesmo dia) —
// mesma lista de src/tasks/task-type.constants.ts no backend (mantido à
// mão, sem tipos compartilhados entre os dois projetos npm, ver
// CLAUDE.md).
export const CONTACT_REQUIRED_TASK_TYPES: TaskType[] = ["ligacao", "reuniao", "visita", "email"];

export function listTasks(
  token: string,
  options: { overdue?: boolean; status?: TaskStatus; companyId?: string } = {},
): Promise<PaginatedResult<Task>> {
  const query = new URLSearchParams({ pageSize: "100" });
  if (options.overdue) query.set("overdue", "true");
  if (options.status) query.set("status", options.status);
  if (options.companyId) query.set("companyId", options.companyId);
  return apiFetch<PaginatedResult<Task>>(`/tasks?${query.toString()}`, {
    token,
  });
}

export function getTask(token: string, id: string): Promise<TaskWithDetails> {
  return apiFetch<TaskWithDetails>(`/tasks/${id}`, { token });
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  dueAt?: string;
  tipo?: TaskType;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  assigneeUserId?: string;
  // Carimbo de itens da oportunidade de origem (2026-09-04) — só com
  // opportunityId; o backend recusa tag fora da lista do card.
  tags?: string[];
}

export function createTask(token: string, input: CreateTaskInput): Promise<Task> {
  return apiFetch<Task>("/tasks", { method: "POST", token, body: input });
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  dueAt?: string;
  tipo?: TaskType;
  contactId?: string;
  status?: TaskStatus;
  assigneeUserId?: string;
  // Substitui a lista inteira de carimbos (mesma regra de CreateTaskInput).
  tags?: string[];
}

export function updateTask(
  token: string,
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  return apiFetch<Task>(`/tasks/${id}`, { method: "PATCH", token, body: input });
}

export function deleteTask(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/tasks/${id}`, { method: "DELETE", token });
}
