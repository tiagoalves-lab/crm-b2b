"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import {
  createChecklistItem,
  createComment,
  deleteChecklistItem,
  deleteComment,
  updateChecklistItem,
} from "@/lib/api/task-cards";
import {
  createTaskList,
  deleteTaskList,
  updateTaskList,
} from "@/lib/api/task-lists";
import { createTask, deleteTask, updateTask } from "@/lib/api/tasks";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

// Toda action de formulário volta pra essa mesma URL (preserva view/card/
// month via campo oculto `back`) — sem isso, um erro no card detail
// mandaria o usuário de volta pra lista em vez do card que ele editava.
function backPath(formData: FormData): string {
  return emptyToUndefined(formData.get("back")) ?? "/dashboard/tarefas";
}

export async function createTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);

  try {
    await createTask(token, {
      title: String(formData.get("title") ?? "").trim(),
      dueAt: emptyToUndefined(formData.get("dueAt")),
      companyId: emptyToUndefined(formData.get("companyId")),
      contactId: emptyToUndefined(formData.get("contactId")),
      opportunityId: emptyToUndefined(formData.get("opportunityId")),
      listId: emptyToUndefined(formData.get("listId")),
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function completeTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const id = String(formData.get("id"));

  try {
    await updateTask(token, id, { status: "done" });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function reopenTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const id = String(formData.get("id"));

  try {
    await updateTask(token, id, { status: "pending" });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function deleteTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await deleteTask(token, id);
  } catch (error) {
    redirectWithError("/dashboard/tarefas", error);
  }

  revalidatePath("/dashboard/tarefas");
}

// Edição do cartão (título/descrição/prazo/responsável) — chamada pelo
// painel de detalhe.
export async function updateTaskDetailAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const id = String(formData.get("id"));

  try {
    await updateTask(token, id, {
      title: emptyToUndefined(formData.get("title")),
      description: String(formData.get("description") ?? ""),
      dueAt: emptyToUndefined(formData.get("dueAt")),
      assigneeUserId: emptyToUndefined(formData.get("assigneeUserId")),
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

// Drag-and-drop no Kanban chama isso direto (não é submit de form) — sem
// redirectWithError aqui, o Client Component trata o erro sozinho.
export async function moveTaskAction(
  taskId: string,
  listId: string,
  position: number,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getServerAccessToken();
  try {
    await updateTask(token, taskId, { listId, position });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro ao mover o cartão.",
    };
  }
  revalidatePath("/dashboard/tarefas");
  return { ok: true };
}

// ---------- Colunas (TaskList) ----------

export async function createTaskListAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);

  try {
    await createTaskList(token, {
      name: String(formData.get("name") ?? "").trim(),
      order: Number(formData.get("order") ?? 0),
      isDoneList: formData.get("isDoneList") === "on",
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function updateTaskListAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const id = String(formData.get("id"));

  try {
    await updateTaskList(token, id, {
      name: emptyToUndefined(formData.get("name")),
      order: formData.get("order") ? Number(formData.get("order")) : undefined,
      isDoneList: formData.get("isDoneList") === "on",
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function deleteTaskListAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const id = String(formData.get("id"));

  try {
    await deleteTaskList(token, id);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

// ---------- Checklist ----------

export async function createChecklistItemAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const text = String(formData.get("text") ?? "").trim();

  if (text) {
    try {
      await createChecklistItem(token, taskId, text);
    } catch (error) {
      redirectWithError(back, error);
    }
  }

  revalidatePath("/dashboard/tarefas");
}

export async function toggleChecklistItemAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const itemId = String(formData.get("itemId"));
  const done = formData.get("done") === "true";

  try {
    await updateChecklistItem(token, taskId, itemId, { done: !done });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

export async function deleteChecklistItemAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const itemId = String(formData.get("itemId"));

  try {
    await deleteChecklistItem(token, taskId, itemId);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}

// ---------- Comentários ----------

export async function createCommentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const body = String(formData.get("body") ?? "").trim();

  if (body) {
    try {
      await createComment(token, taskId, body);
    } catch (error) {
      redirectWithError(back, error);
    }
  }

  revalidatePath("/dashboard/tarefas");
}

export async function deleteCommentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const commentId = String(formData.get("commentId"));

  try {
    await deleteComment(token, taskId, commentId);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
}
