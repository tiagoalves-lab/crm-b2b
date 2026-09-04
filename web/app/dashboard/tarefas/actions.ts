"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { errorMessage, redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { createComment, deleteComment } from "@/lib/api/task-cards";
import {
  createUploadUrl,
  deleteAttachment,
  getDownloadUrl,
  listAttachments,
  type TaskAttachment,
} from "@/lib/api/task-attachments";
import { createTask, deleteTask, updateTask } from "@/lib/api/tasks";
import type { CreateTaskInput, UpdateTaskInput } from "@/lib/api/tasks";
import { createContact, listContacts } from "@/lib/api/contacts";
import type { CreateContactInput } from "@/lib/api/contacts";
import type { Contact, Task, TaskComment, TaskStatus } from "@/lib/api/types";

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

// Carimbo de itens da oportunidade (2026-09-04): um <input type="hidden"
// name="tags"> por chip marcado (TagPicker). Sem chip, não manda o campo.
function tagsFrom(formData: FormData): string[] | undefined {
  const tags = formData.getAll("tags").filter((t): t is string => typeof t === "string" && t.trim() !== "");
  return tags.length > 0 ? tags : undefined;
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
      tags: tagsFrom(formData),
    });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  // Comentário inicial (opcional) — mesmo endpoint já usado no cartão de
  // uma tarefa existente (addTaskCommentAction), só que chamado uma vez
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
  // cartão de uma tarefa existente (uploadTaskAttachmentAction): o binário
  // nunca passa pelo NestJS, só esta Server Action assina a URL e faz o
  // PUT direto no Storage do Supabase.
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      await enviarArquivo(token, task.id, file);
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  revalidatePath("/dashboard/tarefas");
  return { ok: true };
}

// ---------- Lista de Tarefas (checkbox de concluir/reabrir) ----------
// Aqui o redirect é seguro: a lista é página comum, sem modal interceptado,
// e a ação volta pra mesma URL (?view/month preservados via `back`).

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

// ---------- Ficha da tarefa (modal / página) ----------
//
// Reescrito em 2026-09-03 depois do botão "Concluindo…" travar pra sempre
// dentro do modal: a versão antiga usava revalidatePath()+redirect() em
// cada botão, e redirect de Server Action dentro de rota interceptada
// (@modal) é o ponto frágil conhecido do Next (mesmo motivo de
// createTaskModalAction acima não redirecionar). Agora TODA ação da ficha
// devolve o resultado (ActionResult) e quem atualiza a tela é o client
// component (tarefas/_detail/task-detail.tsx): a resposta aparece na hora
// e um router.refresh() em transição põe a lista atrás em dia sem travar
// nada. Sem revalidatePath aqui de propósito — com ele o Next re-renderiza
// a rota inteira DENTRO da resposta da action e o client refaz de novo:
// duas rodadas de ~15 chamadas ao backend por clique.

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function fail(error: unknown): { ok: false; message: string } {
  return { ok: false, message: errorMessage(error) };
}

export async function setTaskStatusAction(
  id: string,
  status: TaskStatus,
): Promise<ActionResult<Task>> {
  if (status !== "pending" && status !== "done") {
    return { ok: false, message: "Situação inválida." };
  }
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await updateTask(token, String(id), { status }) };
  } catch (error) {
    return fail(error);
  }
}

// Arrastar o card no calendário pra outro dia = mudar o prazo (2026-09-04).
// Chamada direta do client component (calendar-view.tsx), devolve
// resultado — mesmo padrão de moveOpportunityStageAction no Pipeline.
export async function moveTaskDueDateAction(id: string, dayKey: string): Promise<ActionResult<Task>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey))) {
    return { ok: false, message: "Data inválida." };
  }
  const token = await getServerAccessToken();
  try {
    const task = await updateTask(token, String(id), { dueAt: String(dayKey) });
    revalidatePath("/dashboard/tarefas");
    return { ok: true, data: task };
  } catch (error) {
    return fail(error);
  }
}

export async function saveTaskDetailAction(
  id: string,
  input: UpdateTaskInput,
): Promise<ActionResult<Task>> {
  const token = await getServerAccessToken();
  try {
    const task = await updateTask(token, String(id), {
      title: str(input.title),
      description: typeof input.description === "string" ? input.description : "",
      dueAt: str(input.dueAt),
      tipo: str(input.tipo) as UpdateTaskInput["tipo"],
      contactId: str(input.contactId),
      assigneeUserId: str(input.assigneeUserId),
      // Lista inteira de carimbos (pode ser vazia = tirar todos); só vai
      // quando a ficha mandou o campo.
      tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
    });
    return { ok: true, data: task };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteTaskClientAction(id: string): Promise<ActionResult<null>> {
  const token = await getServerAccessToken();
  try {
    await deleteTask(token, String(id));
    return { ok: true, data: null };
  } catch (error) {
    return fail(error);
  }
}

export async function addTaskCommentAction(
  taskId: string,
  body: string,
): Promise<ActionResult<TaskComment>> {
  const text = str(body);
  if (!text) return { ok: false, message: "Escreva o comentário antes de enviar." };
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await createComment(token, String(taskId), text) };
  } catch (error) {
    return fail(error);
  }
}

export async function removeTaskCommentAction(
  taskId: string,
  commentId: string,
): Promise<ActionResult<null>> {
  const token = await getServerAccessToken();
  try {
    await deleteComment(token, String(taskId), String(commentId));
    return { ok: true, data: null };
  } catch (error) {
    return fail(error);
  }
}

// O binário nunca passa pelo NestJS: o backend só assina a URL de upload;
// quem faz o PUT do arquivo é esta Server Action, direto no Storage do
// Supabase — mesmo raciocínio de nunca expor a service role key ao
// navegador (docs/seguranca.md).
async function enviarArquivo(token: string, taskId: string, file: File): Promise<void> {
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
}

// Recebe o FormData do <form> de anexo (campo "file") e devolve a lista
// já atualizada, pra ficha mostrar o arquivo sem esperar o refresh.
export async function uploadTaskAttachmentAction(
  taskId: string,
  formData: FormData,
): Promise<ActionResult<TaskAttachment[]>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecione um arquivo pra enviar." };
  }
  const token = await getServerAccessToken();
  try {
    await enviarArquivo(token, String(taskId), file);
    return { ok: true, data: await listAttachments(token, String(taskId)) };
  } catch (error) {
    return fail(error);
  }
}

export async function removeTaskAttachmentAction(
  taskId: string,
  attachmentId: string,
): Promise<ActionResult<TaskAttachment[]>> {
  const token = await getServerAccessToken();
  try {
    await deleteAttachment(token, String(taskId), String(attachmentId));
    return { ok: true, data: await listAttachments(token, String(taskId)) };
  } catch (error) {
    return fail(error);
  }
}

// Gera a signed URL só quando clicado (nunca antecipado na listagem) —
// evita assinar N URLs a cada carregamento da ficha. Quem abre a URL é o
// navegador (task-detail.tsx), não um redirect daqui.
export async function attachmentDownloadUrlAction(
  taskId: string,
  attachmentId: string,
): Promise<ActionResult<string>> {
  const token = await getServerAccessToken();
  try {
    const { url } = await getDownloadUrl(token, String(taskId), String(attachmentId));
    return { ok: true, data: url };
  } catch (error) {
    return fail(error);
  }
}
