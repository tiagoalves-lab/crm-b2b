"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { ApiError } from "@/lib/api/client";
import { companyDisplayName, createCompany, lookupCnpj } from "@/lib/api/companies";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "@/lib/api/opportunities";
import { createPipeline, createStage } from "@/lib/api/pipelines";
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

export async function createStageAction(formData: FormData) {
  const token = await getServerAccessToken();
  const pipelineId = String(formData.get("pipelineId"));
  const name = String(formData.get("name") ?? "").trim();
  const order = Number(formData.get("order") ?? 0);
  const probability = Number(formData.get("probability") ?? 0);

  try {
    await createStage(token, pipelineId, { name, order, probability });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
  redirectWithMessage("/dashboard/pipeline", "Etapa adicionada");
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
