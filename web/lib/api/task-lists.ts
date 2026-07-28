import { apiFetch } from "./client";
import type { TaskList } from "./types";

export function listTaskLists(token: string): Promise<TaskList[]> {
  return apiFetch<TaskList[]>("/task-lists", { token });
}

export interface CreateTaskListInput {
  name: string;
  order: number;
  isDoneList?: boolean;
}

export function createTaskList(
  token: string,
  input: CreateTaskListInput,
): Promise<TaskList> {
  return apiFetch<TaskList>("/task-lists", { method: "POST", token, body: input });
}

export interface UpdateTaskListInput {
  name?: string;
  order?: number;
  isDoneList?: boolean;
}

export function updateTaskList(
  token: string,
  id: string,
  input: UpdateTaskListInput,
): Promise<TaskList> {
  return apiFetch<TaskList>(`/task-lists/${id}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteTaskList(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/task-lists/${id}`, { method: "DELETE", token });
}
