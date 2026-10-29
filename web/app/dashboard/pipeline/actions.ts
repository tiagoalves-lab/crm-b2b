"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { errorMessage, redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { ApiError } from "@/lib/api/client";
import { listActivities } from "@/lib/api/activities";
import { companyDisplayName } from "@/lib/api/companies";
import {
  createOpportunity,
  deleteOpportunity,
  reorderOpportunities,
  updateOpportunity,
} from "@/lib/api/opportunities";
import { createTask, type CreateTaskInput } from "@/lib/api/tasks";
import {
  createUploadUrl,
  deleteAttachment,
  getDownloadUrl,
  listAttachments,
  publishAttachment,
  type OpportunityAttachment,
} from "@/lib/api/opportunity-attachments";
import {
  createComment,
  deleteComment,
  markAllCommentsRead,
  setCommentMentions,
  setCommentRead,
  setCommentPinned,
  setMentionDone,
  updateComment,
} from "@/lib/api/opportunity-comments";
import { createItem, deleteItem, updateItem } from "@/lib/api/opportunity-items";
import { createLostReason, listLostReasons, type LostReason } from "@/lib/api/opportunity-lost-reasons";
import { createPipeline } from "@/lib/api/pipelines";
import { approveLead } from "@/lib/api/raw-leads";
import { searchEmpresaLead, type BuscaEmpresaLeadResult } from "@/lib/api/search";
import type { SlaTratamento } from "./sla";
import type { Activity, Opportunity, OpportunityComment, OpportunityItem } from "@/lib/api/types";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

function actionError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}


export async function createPipelineAction(formData: FormData) {
  const token = await getServerAccessToken();
  const name = String(formData.get("name") ?? "").trim();

  try {
    await createPipeline(token, { name, isDefault: true });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
  redirectWithMessage("/dashboard/pipeline", "Pipeline criado");
}

// Devolve o resultado em vez de redirecionar no sucesso — usado via
// useActionState (nova/nova-card.tsx) pro modal fechar com router.back()
// no client depois de confirmar. Mesmo motivo de criarEmpresaAction em
// empresas/actions.ts: redirect() de dentro da Server Action não derruba
// o slot @modal da rota interceptada.
//
// Cadastro pelo card (2026-09-04): cria a oportunidade já com a lista de
// itens e em seguida grava o comentário inicial — com as tags escolhidas
// — mesma dança de tarefas/actions.ts createTaskModalAction (anexos vão
// depois, pelo navegador). Se comentário/tarefa falharem DEPOIS de a
// oportunidade existir, devolve ok mesmo assim (senão um segundo clique
// criaria a oportunidade de novo) e avisa no toast o que faltou.
export async function createOpportunityAction(
  _prevState: ActionResult<{ toast: string; opportunityId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ toast: string; opportunityId: string }>> {
  const token = await getServerAccessToken();
  const companyId = String(formData.get("companyId") ?? "").trim();

  if (!companyId) {
    return { ok: false, message: "Selecione uma empresa para a oportunidade." };
  }

  let created: Opportunity;
  try {
    created = await createOpportunity(token, {
      companyId,
      pipelineId: String(formData.get("pipelineId")),
      stageId: String(formData.get("stageId")),
      amount: Number(formData.get("amount")),
      currency: String(formData.get("currency") ?? "BRL").toUpperCase(),
      expectedCloseDate: emptyToUndefined(formData.get("expectedCloseDate")),
      description: emptyToUndefined(formData.get("description")),
      items: itemsFrom(formData),
    });
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao criar a oportunidade.") };
  }

  const pendencias: string[] = [];
  const comment = String(formData.get("comment") ?? "").trim();
  if (comment) {
    try {
      await createComment(token, created.id, comment, tagsFrom(formData, "tags"));
    } catch (error) {
      pendencias.push(`o comentário (${errorMessage(error)})`);
    }
  }
  // Anexos do cadastro NÃO vêm por aqui (2026-09-17): o card manda depois,
  // do navegador, com o id devolvido abaixo — ver nova-card.tsx.

  // Tarefa cadastrada junto (2026-09-04) — só se a seção "Tarefa" foi
  // aberta e preenchida no card; nasce vinculada à oportunidade nova.
  const taskTitle = String(formData.get("taskTitle") ?? "").trim();
  let taskCreated = false;
  if (taskTitle) {
    try {
      const taskTags = tagsFrom(formData, "taskTags");
      await createTask(token, {
        title: taskTitle,
        tipo: emptyToUndefined(formData.get("tipo")) as CreateTaskInput["tipo"],
        contactId: emptyToUndefined(formData.get("contactId")),
        dueAt: emptyToUndefined(formData.get("taskDueAt")),
        assigneeUserId: emptyToUndefined(formData.get("taskAssigneeUserId")),
        opportunityId: created.id,
        tags: taskTags.length > 0 ? taskTags : undefined,
      });
      taskCreated = true;
    } catch (error) {
      pendencias.push(`a tarefa (${errorMessage(error)})`);
    }
  }

  revalidatePath("/dashboard/pipeline");
  if (taskCreated) revalidatePath("/dashboard/tarefas");
  const criado = taskCreated ? "Oportunidade e tarefa criadas" : "Oportunidade criada";
  return {
    ok: true,
    data: {
      opportunityId: created.id,
      toast:
        pendencias.length === 0
          ? criado
          : `${criado}, mas não deu pra salvar ${pendencias.join(", ")}. Abra o card e tente de novo.`,
    },
  };
}

// A lista lateral viaja num único campo oculto (JSON) — ver nova-card.tsx.
function itemsFrom(formData: FormData): string[] {
  try {
    const parsed: unknown = JSON.parse(String(formData.get("items") ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Um <input type="hidden"> por chip marcado (TagPicker) — `tags` pro
// comentário inicial, `taskTags` pra tarefa cadastrada junto.
function tagsFrom(formData: FormData, field: "tags" | "taskTags"): string[] {
  return formData.getAll(field).filter((t): t is string => typeof t === "string" && t.trim() !== "");
}



// Drag-and-drop no board (SPEC-CRM-GAMA.md §4.2) chama isso direto — não é
// submit de form.
// Devolve o `version` novo junto do ok. Sem isso, o board só descobria a
// versão nova pela revalidação (ida ao servidor, ~250-700ms) e um segundo
// arraste feito antes disso mandava a versão velha, levava 409 e o cartão
// "voltava" sozinho — bug real observado em produção em 2026-08-12.
export async function moveOpportunityStageAction(
  opportunityId: string,
  stageId: string,
  version: number,
  // Obrigatório só ao voltar de Negociação para uma etapa de proposta
  // (SLA automático, 2026-09-16) — a tela pergunta antes de chamar.
  slaTratamento?: SlaTratamento,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  const token = await getServerAccessToken();
  if (slaTratamento !== undefined && slaTratamento !== "erro_elaboracao" && slaTratamento !== "alteracao_cliente") {
    return { ok: false, error: "Tratamento de SLA inválido." };
  }
  let updated;
  try {
    updated = await updateOpportunity(token, opportunityId, { version, stageId, slaTratamento });
  } catch (error) {
    return { ok: false, error: actionError(error, "Erro ao mover a oportunidade.") };
  }
  revalidatePath("/dashboard/pipeline");
  return { ok: true, version: updated.version };
}

// Nova ordem dos cards de uma coluna (2026-09-14) — arrasto vertical no
// quadro. Não mexe na versão da oportunidade (ver
// OpportunityService#reorder no backend), então não conflita com o
// "Salvar" de um card aberto.
export async function reorderOpportunitiesAction(
  stageId: string,
  orderedIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const token = await getServerAccessToken();
  try {
    await reorderOpportunities(token, String(stageId), orderedIds.map(String));
  } catch (error) {
    return { ok: false, error: actionError(error, "Erro ao reordenar os cards.") };
  }
  revalidatePath("/dashboard/pipeline");
  return { ok: true };
}

// ---------- Seletor de empresa/lead (§3.5/§4.2.1) ----------
// Chamadas diretas (RPC) a partir do client component do picker — não são
// submit de form, por isso devolvem valor em vez de redirect.

export async function searchEmpresaLeadAction(
  q: string,
): Promise<BuscaEmpresaLeadResult[]> {
  const token = await getServerAccessToken();
  try {
    return await searchEmpresaLead(token, q);
  } catch {
    return [];
  }
}

export async function approveLeadAction(
  rawLeadId: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const token = await getServerAccessToken();
  try {
    const company = await approveLead(token, rawLeadId);
    revalidatePath("/dashboard/empresas");
    return { ok: true, data: { id: company.id, name: companyDisplayName(company) } };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao aprovar o lead.") };
  }
}

// ---------- Comentários (feature nova, fora do SPEC-CRM-GAMA.md) ----------



// ---------- Anexos (feature nova, fora do SPEC-CRM-GAMA.md) ----------
// O binário nunca passa pelo NestJS: o backend só assina a URL de
// upload; quem faz o PUT do arquivo é este Server Action, direto no
// Storage do Supabase — mesmo padrão de tarefas/actions.ts.

// ---------- Card da oportunidade (modal / página) ----------
//
// Reescrito em 2026-09-03 no mesmo molde da ficha de tarefa
// (tarefas/actions.ts): toda ação devolve resultado e quem atualiza a
// tela é o client component (pipeline/_detail/opportunity-detail.tsx).
// Sem revalidatePath nem redirect aqui — dentro do @modal isso travava o
// botão ou fechava-e-reabria o card.

type DetailResult<T> = { ok: true; data: T } | { ok: false; message: string };

function detailFail(error: unknown): { ok: false; message: string } {
  return { ok: false, message: errorMessage(error) };
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// O próprio card é o formulário de edição desde 2026-09-04 (pedido do
// usuário: o botão "Editar", que abria outra tela, foi apagado). Devolve
// o registro atualizado — inclusive a nova `version`, que o card guarda
// pro próximo salvamento — em vez de redirecionar, mesmo motivo das
// outras ações do card (redirect de Server Action não derruba o slot
// @modal da rota interceptada).
//
// Campo vazio = não mexe no valor atual; a etapa não entra aqui de
// propósito (some da ficha junto com o botão Editar — quem move o card
// de etapa é o arrasto no quadro).
export async function saveOpportunityDetailAction(
  id: string,
  version: number,
  input: {
    ownerUserId?: string;
    // Ausente quando a soma dos itens manda no valor (o campo fica só
    // leitura na tela e quem grava é o backend, ao mexer nos itens).
    amount?: number;
    currency?: string;
    expectedCloseDate?: string;
    description?: string;
  },
): Promise<DetailResult<Opportunity>> {
  const token = await getServerAccessToken();
  let amount: number | undefined;
  if (input.amount !== undefined) {
    amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, message: "Informe um valor válido." };
    }
  }
  try {
    return {
      ok: true,
      data: await updateOpportunity(token, String(id), {
        version: Number(version),
        ownerUserId: trimOrUndefined(input.ownerUserId),
        amount,
        currency: (trimOrUndefined(input.currency) ?? "BRL").toUpperCase(),
        expectedCloseDate: trimOrUndefined(input.expectedCloseDate),
        // String vazia é intencional: limpa a descrição.
        description: typeof input.description === "string" ? input.description : undefined,
      }),
    };
  } catch (error) {
    return detailFail(error);
  }
}

// Perda sempre com motivo da lista (2026-09-17): o modal "Por que a
// negociação foi perdida?" só oferece motivos cadastrados — ver
// opportunity-lost-reasons.ts.
export async function setOpportunityStatusAction(
  id: string,
  version: number,
  status: "won" | "open" | "lost",
  lostReason?: string,
): Promise<DetailResult<Opportunity>> {
  if (status !== "won" && status !== "open" && status !== "lost") {
    return { ok: false, message: "Situação inválida." };
  }
  const motivo = lostReason?.trim();
  if (status === "lost" && !motivo) return { ok: false, message: "Escolha o motivo da perda." };
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await updateOpportunity(token, String(id), {
        version: Number(version),
        status,
        lostReason: status === "lost" ? motivo : undefined,
      }),
    };
  } catch (error) {
    return detailFail(error);
  }
}

// Stand by (pedido do usuário, 2026-10-22): colocar exige a nova previsão
// de fechamento (dia em que ela volta a aparecer no calendário); retomar
// devolve o card ao quadro, na etapa em que estava.
export async function setOpportunityStandbyAction(
  id: string,
  version: number,
  standby: boolean,
  dayKey?: string,
): Promise<DetailResult<Opportunity>> {
  if (standby && !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey ?? ""))) {
    return { ok: false, message: "Informe a nova previsão de fechamento." };
  }
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await updateOpportunity(token, String(id), {
        version: Number(version),
        standby: Boolean(standby),
        expectedCloseDate: standby ? String(dayKey) : undefined,
      }),
    };
  } catch (error) {
    return detailFail(error);
  }
}

export async function listLostReasonsAction(): Promise<DetailResult<LostReason[]>> {
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await listLostReasons(token) };
  } catch (error) {
    return detailFail(error);
  }
}

export async function createLostReasonAction(nome: string): Promise<DetailResult<LostReason>> {
  const texto = String(nome ?? "").trim();
  if (!texto) return { ok: false, message: "Digite o motivo." };
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await createLostReason(token, texto) };
  } catch (error) {
    return detailFail(error);
  }
}

// Arrasto da oportunidade no calendário de Tarefas (2026-09-16): muda só
// a previsão de fechamento. Mesmo molde de moveTaskDueDateAction.
export async function moveOpportunityCloseDateAction(
  id: string,
  version: number,
  dayKey: string,
): Promise<DetailResult<Opportunity>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey))) {
    return { ok: false, message: "Data inválida." };
  }
  const token = await getServerAccessToken();
  try {
    const data = await updateOpportunity(token, String(id), {
      version: Number(version),
      expectedCloseDate: String(dayKey),
    });
    revalidatePath("/dashboard/tarefas");
    revalidatePath("/dashboard/pipeline");
    return { ok: true, data };
  } catch (error) {
    return detailFail(error);
  }
}

export async function deleteOpportunityClientAction(id: string): Promise<DetailResult<null>> {
  const token = await getServerAccessToken();
  try {
    await deleteOpportunity(token, String(id));
    return { ok: true, data: null };
  } catch (error) {
    return detailFail(error);
  }
}

export async function addOpportunityCommentAction(
  opportunityId: string,
  body: string,
  tags: string[] = [],
  // Membros destacados no comentário (2026-09-14).
  mentions: string[] = [],
): Promise<DetailResult<OpportunityComment>> {
  const text = trimOrUndefined(body);
  if (!text) return { ok: false, message: "Escreva o comentário antes de enviar." };
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await createComment(
        token,
        String(opportunityId),
        text,
        Array.isArray(tags) ? tags.map(String) : [],
        Array.isArray(mentions) ? mentions.map(String) : [],
      ),
    };
  } catch (error) {
    return detailFail(error);
  }
}

// Destacar membros num comentário já publicado (2026-09-14) — a lista
// substitui a anterior.
export async function setOpportunityCommentMentionsAction(
  opportunityId: string,
  commentId: string,
  mentions: string[],
): Promise<DetailResult<OpportunityComment>> {
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await setCommentMentions(
        token,
        String(opportunityId),
        String(commentId),
        Array.isArray(mentions) ? mentions.map(String) : [],
      ),
    };
  } catch (error) {
    return detailFail(error);
  }
}

// Baixa da pendência de um comentário que destacou você (2026-09-14).
export async function setOpportunityMentionDoneAction(
  opportunityId: string,
  commentId: string,
  resolvida: boolean,
): Promise<DetailResult<OpportunityComment>> {
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await setMentionDone(
        token,
        String(opportunityId),
        String(commentId),
        Boolean(resolvida),
      ),
    };
  } catch (error) {
    return detailFail(error);
  }
}

// ---------- Lista lateral de itens (2026-09-04) ----------
// Ver src/opportunities/opportunity-item.service.ts — adicionar/remover
// exige "write" na oportunidade; a lista volta embutida no GET do card.

export async function addOpportunityItemAction(
  opportunityId: string,
  name: string,
): Promise<DetailResult<OpportunityItem>> {
  const text = trimOrUndefined(name);
  if (!text) return { ok: false, message: "Digite o nome do item." };
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await createItem(token, String(opportunityId), text) };
  } catch (error) {
    return detailFail(error);
  }
}

// Valor de um item da lista lateral (2026-09-04). O backend recalcula
// o valor da oportunidade (soma dos itens) e devolve o item; o card
// mostra o total na hora.
export async function setOpportunityItemAmountAction(
  opportunityId: string,
  itemId: string,
  amount: number | null,
): Promise<DetailResult<OpportunityItem>> {
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    return { ok: false, message: "Informe um valor válido." };
  }
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await updateItem(token, String(opportunityId), String(itemId), {
        amount: amount === null ? null : Number(amount.toFixed(2)),
      }),
    };
  } catch (error) {
    return detailFail(error);
  }
}

export async function removeOpportunityItemAction(
  opportunityId: string,
  itemId: string,
): Promise<DetailResult<null>> {
  const token = await getServerAccessToken();
  try {
    await deleteItem(token, String(opportunityId), String(itemId));
    return { ok: true, data: null };
  } catch (error) {
    return detailFail(error);
  }
}

export async function removeOpportunityCommentAction(
  opportunityId: string,
  commentId: string,
): Promise<DetailResult<null>> {
  const token = await getServerAccessToken();
  try {
    await deleteComment(token, String(opportunityId), String(commentId));
    return { ok: true, data: null };
  } catch (error) {
    return detailFail(error);
  }
}

// Editar o texto do comentário (2026-10-16).
export async function updateOpportunityCommentAction(
  opportunityId: string,
  commentId: string,
  body: string,
): Promise<DetailResult<OpportunityComment>> {
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await updateComment(token, String(opportunityId), String(commentId), String(body)),
    };
  } catch (error) {
    return detailFail(error);
  }
}

// Histórico do card (2026-09-14) — a trilha que o backend grava a cada
// troca de etapa, edição de campo e mexida na lista de itens. Carregada
// só quando o usuário aperta "Histórico" no rodapé do card.
export async function listOpportunityHistoryAction(
  opportunityId: string,
): Promise<DetailResult<Activity[]>> {
  const token = await getServerAccessToken();
  try {
    const { items } = await listActivities(token, { opportunityId: String(opportunityId) });
    return { ok: true, data: items };
  } catch (error) {
    return detailFail(error);
  }
}

// Fixar/desafixar comentário (2026-09-09) — o fixado abre no topo do
// histórico de anotações do Pipeline (ícone da barra da tela).
export async function setOpportunityCommentPinnedAction(
  opportunityId: string,
  commentId: string,
  pinned: boolean,
): Promise<DetailResult<OpportunityComment>> {
  const token = await getServerAccessToken();
  try {
    return {
      ok: true,
      data: await setCommentPinned(
        token,
        String(opportunityId),
        String(commentId),
        Boolean(pinned),
      ),
    };
  } catch (error) {
    return detailFail(error);
  }
}

// Upload pelo navegador (2026-09-17): o arquivo passava por uma Server
// Action e a Vercel corta o corpo em 1 MB ("Body exceeded 1 MB limit" —
// qualquer PDF maior quebrava o card). Agora a action só registra o anexo
// e devolve a URL assinada; o navegador faz o PUT direto no Storage do
// Supabase (origem já liberada no connect-src da CSP). Fluxo completo em
// _detail/enviar-anexos.ts.
export async function prepareOpportunityAttachmentAction(
  opportunityId: string,
  file: { fileName: string; mimeType?: string; sizeBytes: number },
): Promise<DetailResult<{ attachmentId: string; uploadUrl: string }>> {
  const token = await getServerAccessToken();
  try {
    const { attachment, uploadUrl } = await createUploadUrl(token, String(opportunityId), {
      fileName: String(file.fileName),
      mimeType: file.mimeType ? String(file.mimeType) : undefined,
      sizeBytes: Number(file.sizeBytes),
    });
    return { ok: true, data: { attachmentId: attachment.id, uploadUrl } };
  } catch (error) {
    return detailFail(error);
  }
}

// Histórico de anotações: marcar como lido (2026-09-17). Sem revalidate
// nem redirect — a lista é client e atualiza o próprio estado.
export async function setCommentReadAction(
  commentId: string,
  lido: boolean,
): Promise<DetailResult<{ id: string; lido: boolean }>> {
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await setCommentRead(token, String(commentId), Boolean(lido)) };
  } catch (error) {
    return detailFail(error);
  }
}

export async function markAllCommentsReadAction(): Promise<DetailResult<{ marcadas: number }>> {
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await markAllCommentsRead(token) };
  } catch (error) {
    return detailFail(error);
  }
}

export async function listOpportunityAttachmentsAction(
  opportunityId: string,
): Promise<DetailResult<OpportunityAttachment[]>> {
  const token = await getServerAccessToken();
  try {
    return { ok: true, data: await listAttachments(token, String(opportunityId)) };
  } catch (error) {
    return detailFail(error);
  }
}

export async function removeOpportunityAttachmentClientAction(
  opportunityId: string,
  attachmentId: string,
): Promise<DetailResult<OpportunityAttachment[]>> {
  const token = await getServerAccessToken();
  try {
    await deleteAttachment(token, String(opportunityId), String(attachmentId));
    return { ok: true, data: await listAttachments(token, String(opportunityId)) };
  } catch (error) {
    return detailFail(error);
  }
}

// Publicar libera o anexo pra gerente e representante — e não tem volta
// (a confirmação fica na tela, antes de chamar aqui).
export async function publishOpportunityAttachmentClientAction(
  opportunityId: string,
  attachmentId: string,
): Promise<DetailResult<OpportunityAttachment[]>> {
  const token = await getServerAccessToken();
  try {
    await publishAttachment(token, String(opportunityId), String(attachmentId));
    return { ok: true, data: await listAttachments(token, String(opportunityId)) };
  } catch (error) {
    return detailFail(error);
  }
}

export async function opportunityAttachmentUrlAction(
  opportunityId: string,
  attachmentId: string,
): Promise<DetailResult<string>> {
  const token = await getServerAccessToken();
  try {
    const { url } = await getDownloadUrl(token, String(opportunityId), String(attachmentId));
    return { ok: true, data: url };
  } catch (error) {
    return detailFail(error);
  }
}
