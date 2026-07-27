import { apiFetch } from "./client";
import type { PaginatedResult, Task, TaskStatus } from "./types";

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

export interface CreateTaskInput {
  title: string;
  dueAt?: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
}

export function createTask(token: string, input: CreateTaskInput): Promise<Task> {
  return apiFetch<Task>("/tasks", { method: "POST", token, body: input });
}

export interface UpdateTaskInput {
  title?: string;
  dueAt?: string;
  status?: TaskStatus;
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
