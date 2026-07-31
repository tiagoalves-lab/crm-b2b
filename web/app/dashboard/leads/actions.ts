"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError } from "@/lib/api/action-helpers";
import { ApiError } from "@/lib/api/client";
import {
  approveLead,
  bulkApproveLeads,
  bulkDiscardLeads,
  createRawLead,
  discardLead,
  rescoreLeads,
  type BulkResult,
} from "@/lib/api/raw-leads";
import type { LeadFonte } from "@/lib/api/types";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

export async function createRawLeadAction(formData: FormData) {
  const token = await getServerAccessToken();
  const razaoSocial = String(formData.get("razaoSocial") ?? "").trim();

  try {
    await createRawLead(token, {
      razaoSocial,
      cnpj: emptyToUndefined(formData.get("cnpj")),
      cnaePrincipal: emptyToUndefined(formData.get("cnaePrincipal")),
      cnaeDescricao: emptyToUndefined(formData.get("cnaeDescricao")),
      porte: emptyToUndefined(formData.get("porte")),
      uf: emptyToUndefined(formData.get("uf")),
      municipio: emptyToUndefined(formData.get("municipio")),
      situacao: emptyToUndefined(formData.get("situacao")),
      importador: formData.get("importador") === "on",
      fonte: (emptyToUndefined(formData.get("fonte")) as LeadFonte | undefined) ?? "manual",
    });
  } catch (error) {
    redirectWithError("/dashboard/leads", error);
  }

  revalidatePath("/dashboard/leads");
}

export async function approveOneLeadAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "/dashboard/leads");

  try {
    await approveLead(token, id);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/empresas");
}

export async function discardOneLeadAction(formData: FormData) {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "/dashboard/leads");

  try {
    await discardLead(token, id);
  } catch (error) {
    redirectWithError(back, error);
  }

  revalidatePath("/dashboard/leads");
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

// Bulk approve/discard e recalcular score são chamadas diretas (RPC) a
// partir do client component da tabela (seleção vive em estado
// client-side) — mesmo padrão de CompanyPicker em pipeline/actions.ts.
export async function bulkApproveLeadsAction(
  ids: string[],
): Promise<ActionResult<BulkResult>> {
  const token = await getServerAccessToken();
  try {
    const result = await bulkApproveLeads(token, ids);
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/empresas");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao aprovar os leads selecionados.") };
  }
}

export async function bulkDiscardLeadsAction(
  ids: string[],
): Promise<ActionResult<BulkResult>> {
  const token = await getServerAccessToken();
  try {
    const result = await bulkDiscardLeads(token, ids);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao descartar os leads selecionados.") };
  }
}

export async function rescoreLeadsAction(): Promise<ActionResult<{ updated: number }>> {
  const token = await getServerAccessToken();
  try {
    const result = await rescoreLeads(token);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao recalcular os scores.") };
  }
}
