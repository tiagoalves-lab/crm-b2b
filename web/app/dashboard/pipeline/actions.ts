"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { ApiError } from "@/lib/api/client";
import { companyDisplayName, createCompany, lookupCnpj } from "@/lib/api/companies";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "@/lib/api/opportunities";
import {
  createUploadUrl,
  deleteAttachment,
  getDownloadUrl,
} from "@/lib/api/opportunity-attachments";
import { createComment, deleteComment } from "@/lib/api/opportunity-comments";
import { createPipeline } from "@/lib/api/pipelines";
import { approveLead } from "@/lib/api/raw-leads";
import { searchEmpresaLead, type BuscaEmpresaLeadResult } from "@/lib/api/search";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

function actionError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

// Toda action de anexo/comentário volta pra essa mesma URL (preserva o
// card que o usuário estava editando) — mesmo padrão de backPath em
// tarefas/actions.ts.
function backPath(formData: FormData): string {
  return emptyToUndefined(formData.get("back")) ?? "/dashboard/pipeline";
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
// useActionState (nova-form.tsx) pro modal fechar com router.push no
// client depois de confirmar. Mesmo motivo de createCompanyAction em
// empresas/actions.ts: redirect() de dentro da Server Action não derruba
// o slot @modal da rota interceptada.
export async function createOpportunityAction(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const token = await getServerAccessToken();
  const companyId = String(formData.get("companyId") ?? "").trim();

  if (!companyId) {
    return { ok: false, message: "Selecione uma empresa para a oportunidade." };
  }

  try {
    await createOpportunity(token, {
      companyId,
      pipelineId: String(formData.get("pipelineId")),
      stageId: String(formData.get("stageId")),
      amount: Number(formData.get("amount")),
      currency: String(formData.get("currency") ?? "BRL").toUpperCase(),
      expectedCloseDate: emptyToUndefined(formData.get("expectedCloseDate")),
    });
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao criar a oportunidade.") };
  }

  revalidatePath("/dashboard/pipeline");
  return { ok: true, data: null };
}

// Modal "Editar oportunidade" — valor/moeda/etapa/previsão de fechamento.
export async function updateOpportunityDetailsAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));
  const back = String(formData.get("back") ?? `/dashboard/pipeline/${id}`);

  try {
    await updateOpportunity(token, id, {
      version,
      stageId: String(formData.get("stageId")),
      amount: Number(formData.get("amount")),
      currency: String(formData.get("currency") ?? "BRL").toUpperCase(),
      expectedCloseDate: emptyToUndefined(formData.get("expectedCloseDate")),
    });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/pipeline");
  redirectWithMessage(`/dashboard/pipeline/${id}`, "Oportunidade atualizada");
}

export async function deleteOpportunityAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));

  try {
    await deleteOpportunity(token, id);
  } catch (error) {
    redirectWithError(`/dashboard/pipeline/${id}`, error);
  }

  revalidatePath("/dashboard/pipeline");
  redirectWithMessage("/dashboard/pipeline", "Oportunidade excluída");
}

// Drag-and-drop no board (SPEC-CRM-GAMA.md §4.2) chama isso direto — não é
// submit de form, mesmo padrão de moveTaskAction em tarefas/actions.ts.
export async function moveOpportunityStageAction(
  opportunityId: string,
  stageId: string,
  version: number,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getServerAccessToken();
  try {
    await updateOpportunity(token, opportunityId, { version, stageId });
  } catch (error) {
    return { ok: false, error: actionError(error, "Erro ao mover a oportunidade.") };
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

export async function createCompanyFromCnpjAction(
  cnpj: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const token = await getServerAccessToken();
  try {
    const data = await lookupCnpj(token, cnpj);
    const company = await createCompany(token, {
      razaoSocial: data.razaoSocial,
      fantasia: data.fantasia,
      cpfCnpj: data.cpfCnpj,
      tipo: data.tipo,
      emails: data.emails,
      fones: data.fones,
      logradouro: data.logradouro,
      numero: data.numero,
      complemento: data.complemento,
      bairro: data.bairro,
      cep: data.cep,
      cidade: data.cidade,
      uf: data.uf,
    });
    revalidatePath("/dashboard/empresas");
    return { ok: true, data: { id: company.id, name: companyDisplayName(company) } };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao cadastrar a empresa.") };
  }
}

export async function markWonAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));

  try {
    await updateOpportunity(token, id, { version, status: "won" });
  } catch (error) {
    redirectWithError(`/dashboard/pipeline/${id}`, error);
  }

  revalidatePath("/dashboard/pipeline");
  redirectWithMessage("/dashboard/pipeline", "🎉 Oportunidade fechada!");
}

// Confirmação de motivo (protótipo: askLoseDeal → loseDeal, dois passos)
// acontece na rota .../perder; esta action só aplica.
export async function markLostAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));
  const lostReason = String(formData.get("lostReason") ?? "").trim();

  try {
    await updateOpportunity(token, id, {
      version,
      status: "lost",
      lostReason: lostReason || "Não informado",
    });
  } catch (error) {
    redirectWithError(`/dashboard/pipeline/${id}/perder`, error);
  }

  revalidatePath("/dashboard/pipeline");
  redirectWithMessage("/dashboard/pipeline", "Oportunidade marcada como perdida");
}

export async function reopenAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));
  const back = String(formData.get("back") ?? "/dashboard/pipeline");

  try {
    await updateOpportunity(token, id, { version, status: "open" });
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/pipeline");
  redirectWithMessage("/dashboard/pipeline", "Oportunidade reaberta");
}

// ---------- Comentários (feature nova, fora do SPEC-CRM-GAMA.md) ----------

export async function createOpportunityCommentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const opportunityId = String(formData.get("opportunityId"));
  const body = String(formData.get("body") ?? "").trim();

  if (body) {
    try {
      await createComment(token, opportunityId, body);
    } catch (error) {
      redirectWithError(back, error);
    }
  }

  revalidatePath("/dashboard/pipeline");
}

export async function deleteOpportunityCommentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const opportunityId = String(formData.get("opportunityId"));
  const commentId = String(formData.get("commentId"));

  try {
    await deleteComment(token, opportunityId, commentId);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/pipeline");
}

// ---------- Anexos (feature nova, fora do SPEC-CRM-GAMA.md) ----------
// O binário nunca passa pelo NestJS: o backend só assina a URL de
// upload; quem faz o PUT do arquivo é este Server Action, direto no
// Storage do Supabase — mesmo padrão de tarefas/actions.ts.

export async function uploadOpportunityAttachmentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const opportunityId = String(formData.get("opportunityId"));
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirectWithError(back, new Error("Selecione um arquivo pra enviar."));
    return;
  }

  try {
    const { uploadUrl } = await createUploadUrl(token, opportunityId, {
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

export async function downloadOpportunityAttachmentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const opportunityId = String(formData.get("opportunityId"));
  const attachmentId = String(formData.get("attachmentId"));

  let url: string;
  try {
    const result = await getDownloadUrl(token, opportunityId, attachmentId);
    url = result.url;
  } catch (error) {
    redirectWithError(back, error);
    return;
  }

  redirect(url);
}

export async function deleteOpportunityAttachmentAction(formData: FormData) {
  const token = await getServerAccessToken();
  const back = backPath(formData);
  const opportunityId = String(formData.get("opportunityId"));
  const attachmentId = String(formData.get("attachmentId"));

  try {
    await deleteAttachment(token, opportunityId, attachmentId);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath(back);
  redirectWithMessage(back, "Anexo removido");
}
