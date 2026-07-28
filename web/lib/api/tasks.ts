import { apiFetch } from "./client";
import type { PaginatedResult, Task, TaskStatus, TaskWithDetails } from "./types";

export function listTasks(
  token: string,
  options: { overdue?: boolean; status?: TaskStatus } = {},
): Promise<PaginatedResult<Task>> {
  const query = new URLSearchParams({ pageSize: "100" });
  if (options.overdue) query.set("overdue", "true");
  if (options.status) query.set("status", options.status);
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
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
  listId?: string;
}

export function createTask(token: string, input: CreateTaskInput): Promise<Task> {
  return apiFetch<Task>("/tasks", { method: "POST", token, body: input });
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  dueAt?: string;
  status?: TaskStatus;
  assigneeUserId?: string;
  listId?: string;
  position?: number;
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
