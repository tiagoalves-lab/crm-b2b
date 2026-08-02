"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { errorMessage, redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import {
  createChecklistItem,
  createComment,
  deleteChecklistItem,
  deleteComment,
  updateChecklistItem,
} from "@/lib/api/task-cards";
import {
  createUploadUrl,
  deleteAttachment,
  getDownloadUrl,
} from "@/lib/api/task-attachments";
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
      opportunityId: emptyToUndefined(formData.get("opportunityId")),
      listId: emptyToUndefined(formData.get("listId")),
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
  redirectWithMessage("/dashboard/tarefas", "Tarefa criada");
}

export type CreateTaskState = { ok: true } | { ok: false; message: string };

// Mesma criação de createTaskAction, só que devolve o resultado em vez de
// redirecionar — usado via useActionState só pelo form "Nova tarefa"
// (nova-form.tsx), pro modal fechar com router.push no client depois de
// confirmar (redirect() de dentro da action não derruba o slot @modal da
// rota interceptada — mesmo motivo documentado em empresas/actions.ts
// createCompanyAction). createTaskAction continua como está porque
// também é usada pelo quick-add de tarefa dentro da ficha de lead, que
// não é modal e não deve mudar de comportamento.
export async function createTaskModalAction(
  _prevState: CreateTaskState | null,
  formData: FormData,
): Promise<CreateTaskState> {
  const token = await getServerAccessToken();

  try {
    await createTask(token, {
      title: String(formData.get("title") ?? "").trim(),
      dueAt: emptyToUndefined(formData.get("dueAt")),
      companyId: emptyToUndefined(formData.get("companyId")),
      opportunityId: emptyToUndefined(formData.get("opportunityId")),
      listId: emptyToUndefined(formData.get("listId")),
    });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  revalidatePath("/dashboard/tarefas");
  return { ok: true };
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
  redirectWithMessage(back, "Tarefa concluída ✓");
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
  redirectWithMessage(back, "Tarefa reaberta");
}

export async function deleteTaskAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await deleteTask(token, id);
  } catch (error) {
    redirectWithError(`/dashboard/tarefas/${id}`, error);
  }

  revalidatePath("/dashboard/tarefas");
  redirectWithMessage("/dashboard/tarefas", "Tarefa excluída");
}

// Edição da tarefa (título/descrição/prazo/responsável) — protótipo:
// openTaskForm.
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
  redirectWithMessage(`/dashboard/tarefas/${id}`, "Tarefa atualizada");
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

// ---------- Anexos (SPEC-CRM-GAMA.md §3.2/§4.3, Fatia 8) ----------
// O binário nunca passa pelo NestJS: o backend só assina a URL de
// upload; quem faz o PUT do arquivo é este Server Action, direto no
// Storage do Supabase — mesmo raciocínio de nunca expor a service role
// key ao navegador (docs/seguranca.md).

export async function uploadAttachmentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirectWithError(back, new Error("Selecione um arquivo pra enviar."));
    return;
  }

  try {
    const { uploadUrl } = await createUploadUrl(token, taskId, {
      fileName: file.name,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    const bytes = await file.arrayBuffer();
    const res = await fetch(uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!res.ok) {
      throw new Error(`Falha ao enviar o arquivo pro storage (status ${res.status}).`);
    }
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath(back);
  redirectWithMessage(back, "Anexo adicionado");
}

// Gera a signed URL só quando clicado (nunca antecipado na listagem) e
// redireciona pra ela — evita assinar N URLs a cada carregamento da
// página de detalhe.
export async function downloadAttachmentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const attachmentId = String(formData.get("attachmentId"));

  let url: string;
  try {
    const result = await getDownloadUrl(token, taskId, attachmentId);
    url = result.url;
  } catch (error) {
    redirectWithError(back, error);
    return;
  }

  redirect(url);
}

export async function deleteAttachmentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const taskId = String(formData.get("taskId"));
  const attachmentId = String(formData.get("attachmentId"));

  try {
    await deleteAttachment(token, taskId, attachmentId);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath(back);
  redirectWithMessage(back, "Anexo removido");
}
