"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import { ApiError } from "@/lib/api/client";
import { createCompany, lookupCnpj } from "@/lib/api/companies";
import { createOpportunity, updateOpportunity } from "@/lib/api/opportunities";
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
}

export async function createOpportunityAction(formData: FormData) {
  const token = await getServerAccessToken();

  try {
    await createOpportunity(token, {
      companyId: String(formData.get("companyId")),
      pipelineId: String(formData.get("pipelineId")),
      stageId: String(formData.get("stageId")),
      amount: Number(formData.get("amount")),
      currency: String(formData.get("currency") ?? "BRL").toUpperCase(),
      expectedCloseDate: emptyToUndefined(formData.get("expectedCloseDate")),
    });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
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
    return { ok: true, data: { id: company.id, name: company.name } };
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
      name: data.razaoSocial ?? data.fantasia ?? `Empresa ${cnpj.slice(-4)}`,
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
    return { ok: true, data: { id: company.id, name: company.name } };
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
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

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
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}

export async function reopenAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));

  try {
    await updateOpportunity(token, id, { version, status: "open" });
  } catch (error) {
    redirectWithError("/dashboard/pipeline", error);
  }

  revalidatePath("/dashboard/pipeline");
}
