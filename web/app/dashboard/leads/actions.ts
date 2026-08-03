"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { ApiError } from "@/lib/api/client";
import {
  approveLead,
  bulkApproveLeads,
  bulkDiscardLeads,
  createRawLead,
  discardLead,
  importRawLeadsSpreadsheet,
  rescoreLeads,
  updateLeadTier,
  type BulkResult,
  type ImportResult,
  type ScoreTier,
} from "@/lib/api/raw-leads";
import type { LeadFonte, RawLead } from "@/lib/api/types";

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const str = value ? String(value).trim() : "";
  return str === "" ? undefined : str;
}

export type CreateRawLeadState = { ok: true } | { ok: false; message: string };

// Chamado via useActionState (lead-form.tsx), não <form action=...> direto
// — mesmo motivo do createCompanyAction em empresas/actions.ts: devolve o
// resultado em vez de redirecionar mesmo no sucesso, pro form fechar o
// modal com router.back() no client (redirect() daqui de dentro não
// derruba o slot @modal da rota interceptada).
export async function createRawLeadAction(
  _prevState: CreateRawLeadState | null,
  formData: FormData,
): Promise<CreateRawLeadState> {
  const token = await getServerAccessToken();
  const razaoSocial = String(formData.get("razaoSocial") ?? "").trim();
  if (!razaoSocial) {
    return { ok: false, message: "Preencha a razão social." };
  }

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
    return { ok: false, message: actionError(error, "Erro ao adicionar o lead.") };
  }

  revalidatePath("/dashboard/leads");
  return { ok: true };
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
  redirectWithMessage("/dashboard/leads", "✓ Lead aprovado — virou empresa, com histórico e tarefas preservados");
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
  redirectWithMessage("/dashboard/leads", "Lead descartado (fica na staging)");
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

// Classificação manual (Quente/Morno/Frio) editada direto na linha da
// tabela — RPC via Server Action (mesmo padrão de bulkApprove/rescore),
// não <form action>: precisa devolver o lead atualizado sem navegar.
export async function setLeadTierAction(
  id: string,
  tier: ScoreTier | null,
): Promise<ActionResult<RawLead>> {
  const token = await getServerAccessToken();
  try {
    const result = await updateLeadTier(token, id, tier);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao classificar o lead.") };
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

// Importação em massa por planilha (CSV/XLSX do crawler) — client
// component manda o File direto (mesmo padrão de bulkApprove/rescore:
// RPC via Server Action, não <form action>, porque precisa mostrar o
// resultado — quantos importaram, quais linhas falharam — sem navegar).
export async function importLeadsSpreadsheetAction(
  file: File,
): Promise<ActionResult<ImportResult>> {
  const token = await getServerAccessToken();
  try {
    const result = await importRawLeadsSpreadsheet(token, file);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao importar a planilha.") };
  }
}
