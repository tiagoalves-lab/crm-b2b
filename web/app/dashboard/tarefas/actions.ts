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
import { createTask, deleteTask, updateTask } from "@/lib/api/tasks";
import type { CreateTaskInput, UpdateTaskInput } from "@/lib/api/tasks";
import { createContact, listContacts } from "@/lib/api/contacts";
import type { CreateContactInput } from "@/lib/api/contacts";
import type { Contact, Task } from "@/lib/api/types";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

// Chamada direto (não como form action) pelo client component de
// "Nova tarefa" (nova-form.tsx) sempre que a Empresa/Oportunidade
// selecionada muda — repopula o combobox de Contato sem expor o access
// token do Supabase ao navegador (mesmo motivo de sempre: chamadas à API
// do NestJS só acontecem no servidor).
export async function listCompanyContactsAction(companyId: string): Promise<Contact[]> {
  if (!companyId) return [];
  const token = await getServerAccessToken();
  return listContacts(token, companyId);
}

// Cadastro rápido de contato direto do combobox de Contato (TipoContatoFields)
// — pra quando a empresa escolhida ainda não tem nenhum registrado e o tipo
// da tarefa (ligação/reunião/visita/e-mail) exige um. Chamada direto (não form
// action) porque o resultado precisa voltar pro estado do form em vez de
// redirecionar — mesmo motivo de createTaskModalAction/
// listCompanyContactsAction.
export async function createContactInlineAction(
  companyId: string,
  data: CreateContactInput,
): Promise<ActionResult<Contact>> {
  const token = await getServerAccessToken();
  try {
    const contact = await createContact(token, companyId, data);
    return { ok: true, data: contact };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

// Toda action de formulário volta pra essa mesma URL (preserva view/card/
// month via campo oculto `back`) — sem isso, um erro no card detail
// mandaria o usuário de volta pra lista em vez do card que ele editava.
function backPath(formData: FormData): string {
  return emptyToUndefined(formData.get("back")) ?? "/dashboard/tarefas";
}

export type CreateTaskState = { ok: true } | { ok: false; message: string };

// Toda criação de tarefa passa por aqui — devolve o resultado em vez de
// redirecionar, usado via useActionState pelo form "Nova tarefa"
// (nova-form.tsx, o único jeito de criar tarefa na UI: menu Tarefas,
// "+ Gerar tarefa" do Pipeline e "Criar tarefa" da ficha de lead/empresa
// na Prospecção reusam o mesmo form) — pro modal fechar com router.push
// no client depois de confirmar (redirect() de dentro da action não
// derruba o slot @modal da rota interceptada — mesmo motivo documentado
// em empresas/actions.ts createCompanyAction).
export async function createTaskModalAction(
  _prevState: CreateTaskState | null,
  formData: FormData,
): Promise<CreateTaskState> {
  const token = await getServerAccessToken();

  let task: Task;
  try {
    task = await createTask(token, {
      title: String(formData.get("title") ?? "").trim(),
      dueAt: emptyToUndefined(formData.get("dueAt")),
      tipo: emptyToUndefined(formData.get("tipo")) as CreateTaskInput["tipo"],
      contactId: emptyToUndefined(formData.get("contactId")),
      companyId: emptyToUndefined(formData.get("companyId")),
      opportunityId: emptyToUndefined(formData.get("opportunityId")),
      assigneeUserId: emptyToUndefined(formData.get("assigneeUserId")),
    });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  // Comentário inicial (opcional) — mesmo endpoint já usado no cartão de
  // uma tarefa existente (createCommentAction), só que chamado uma vez
  // logo depois da criação, com o id que acabou de sair do POST acima.
  const comment = String(formData.get("comment") ?? "").trim();
  if (comment) {
    try {
      await createComment(token, task.id, comment);
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  // Anexo inicial (opcional) — mesma dança de signed URL do upload no
  // cartão de uma tarefa existente (uploadAttachmentAction): o binário
  // nunca passa pelo NestJS, só esta Server Action assina a URL e faz o
  // PUT direto no Storage do Supabase.
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const { uploadUrl } = await createUploadUrl(token, task.id, {
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
      return { ok: false, message: errorMessage(error) };
    }
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
      tipo: emptyToUndefined(formData.get("tipo")) as UpdateTaskInput["tipo"],
      contactId: emptyToUndefined(formData.get("contactId")),
      assigneeUserId: emptyToUndefined(formData.get("assigneeUserId")),
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/tarefas");
  redirectWithMessage(`/dashboard/tarefas/${id}`, "Tarefa atualizada");
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
