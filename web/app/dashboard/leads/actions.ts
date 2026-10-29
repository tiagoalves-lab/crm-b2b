"use server";

import { revalidatePath } from "next/cache";
import { getServerAccessToken } from "@/lib/api/auth";
import { errorMessage, redirectWithError, redirectWithMessage } from "@/lib/api/action-helpers";
import { ApiError } from "@/lib/api/client";
import {
  approveLead,
  bulkApproveLeads,
  bulkDiscardLeads,
  createRawLead,
  discardLead,
  importRawLeadsWithContactsSpreadsheet,
  restoreLead,
  unconvertLead,
  updateLeadCadastro,
  updateLeadEtapa,
  updateLeadSegmento,
  updateLeadTags,
  updateLeadTier,
  type BulkResult,
  type CreateRawLeadInput,
  type ImportResult,
  type ScoreTier,
  type UpdateLeadCadastroInput,
} from "@/lib/api/raw-leads";
import { setCompanyTeam, type CompanyTeam } from "@/lib/api/company-team";
import type { Company, RawLead, RawLeadEtapa } from "@/lib/api/types";
import type { FormState } from "@/app/_components/action-form";

// Cadastro manual de empresa na Prospecção (2026-09-14): o formulário em
// modal foi apagado e o cadastro acontece na própria ficha do lead, aba
// "Dados cadastrais" (leads/_ficha/nova-ficha.tsx). Por isso é RPC via
// Server Action (mesma forma de setLeadCadastroAction) e devolve o lead
// criado — a ficha precisa do id pra abrir as outras abas logo depois de
// salvar.
export async function createLeadAction(
  input: CreateRawLeadInput,
): Promise<ActionResult<RawLead>> {
  const token = await getServerAccessToken();
  const razaoSocial = input.razaoSocial.trim();
  if (!razaoSocial) {
    return { ok: false, message: "Preencha a razão social." };
  }

  try {
    const lead = await createRawLead(token, { ...input, razaoSocial });
    revalidatePath("/dashboard/leads");
    return { ok: true, data: lead };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao adicionar a empresa à triagem.") };
  }
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

// Chamada via onClick (approve-button.tsx), não <form action=...> — devolve
// a company recém-criada em vez de redirecionar, pro botão poder abrir o
// modal "Deseja cadastrar uma oportunidade?" sem sair da ficha do lead
// (mesmo motivo de createOpportunityAction: redirect() daqui de dentro não
// derruba o slot @modal/@drawer da rota interceptada).
export async function approveLeadForOpportunityAction(
  id: string,
): Promise<ActionResult<Company>> {
  const token = await getServerAccessToken();
  try {
    const company = await approveLead(token, id);
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/empresas");
    return { ok: true, data: company };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao aprovar o lead.") };
  }
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

// Bulk approve/discard são chamadas diretas (RPC) a
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

// Classificação (Curto/Médio/Longo Prazo) editada direto na linha da
// tabela — RPC via Server Action (mesmo padrão de bulkApprove), não
// <form action>: precisa devolver o lead atualizado sem navegar.
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

// Arrasto do cartão no quadro da Prospecção (2026-09-23) — mesmo padrão
// RPC de setLeadTierAction: não navega, devolve o lead atualizado pro
// quadro confirmar (ou reverter) o movimento que já desenhou na tela.
export async function moveLeadEtapaAction(
  id: string,
  etapa: RawLeadEtapa,
): Promise<ActionResult<RawLead>> {
  const token = await getServerAccessToken();
  try {
    const result = await updateLeadEtapa(token, id, etapa);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao mover o lead de etapa.") };
  }
}

// Tags livres editadas direto na linha da tabela ou na ficha do lead — RPC
// via Server Action (mesmo padrão de setLeadTierAction): manda o array
// completo desejado, não navega, devolve o lead atualizado.
export async function setLeadTagsAction(
  id: string,
  tags: string[],
): Promise<ActionResult<RawLead>> {
  const token = await getServerAccessToken();
  try {
    const result = await updateLeadTags(token, id, tags);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao salvar as tags do lead.") };
  }
}

// Segmento de negócio — mesmo padrão de setLeadTagsAction, mas valor
// único (null limpa, em vez de array vazio).
export async function setLeadSegmentoAction(
  id: string,
  segmento: string | null,
): Promise<ActionResult<RawLead>> {
  const token = await getServerAccessToken();
  try {
    const result = await updateLeadSegmento(token, id, segmento);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao salvar o segmento do lead.") };
  }
}

// Completar o cadastro do lead pela ficha (CNPJ + dados da Receita,
// 2026-09-04) — mesmo padrão de setLeadSegmentoAction: RPC via Server
// Action, sem navegar, devolve o lead atualizado. Quem faz o refresh é o
// componente (useRefresh, por estar dentro do drawer).
export async function setLeadCadastroAction(
  id: string,
  input: UpdateLeadCadastroInput,
): Promise<ActionResult<RawLead>> {
  const token = await getServerAccessToken();
  try {
    const result = await updateLeadCadastro(token, id, input);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao salvar o cadastro do lead.") };
  }
}

// Aba "Equipe de vendas" da ficha (2026-09-21) — mesmo padrão de
// setLeadCadastroAction: RPC via Server Action, sem navegar, devolve a
// equipe salva; quem faz o refresh é o componente (useRefresh, por estar
// dentro do drawer). Revalida também /dashboard/empresas: incluir ou
// tirar alguém muda quem enxerga a empresa naquela lista.
export async function setCompanyTeamAction(
  companyId: string,
  userIds: string[],
): Promise<ActionResult<CompanyTeam>> {
  const token = await getServerAccessToken();
  try {
    const result = await setCompanyTeam(token, companyId, userIds);
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/empresas");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao salvar a equipe de vendas.") };
  }
}

// Importação em massa por planilha, modelo padrão com múltiplos contatos
// por empresa (2026-08-03) — client component manda o File direto (mesmo
// padrão de bulkApprove: RPC via Server Action, não <form action>,
// porque precisa mostrar o resultado — quantos importaram, quais linhas
// falharam — sem navegar). Endpoint /raw-leads/import-contacts, layout de
// cabeçalho fixo no backend.
export async function importLeadsContactsSpreadsheetAction(
  file: File,
): Promise<ActionResult<ImportResult>> {
  const token = await getServerAccessToken();
  try {
    const result = await importRawLeadsWithContactsSpreadsheet(token, file);
    revalidatePath("/dashboard/leads");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: actionError(error, "Erro ao importar a planilha de contatos.") };
  }
}

// Descartar de dentro da ficha (drawer/página): devolve resultado, sem
// redirect (2026-09-03) — ActionForm fecha o drawer com router.back().
export async function discardLeadFormAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  try {
    await discardLead(token, id);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
  return { ok: true, message: "Lead descartado (fica na staging)" };
}

// Recuperar lead descartado (2026-10-19) — mesmo formato do descarte de
// dentro da ficha.
export async function restoreLeadFormAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  try {
    await restoreLead(token, id);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
  return { ok: true, message: "Lead recuperado — voltou para a Prospecção" };
}

// Desconverter lead (2026-10-27) — a trava (proposta vinculada, cliente)
// é do backend; a mensagem dele chega como faixa vermelha.
export async function unconvertLeadFormAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = await getServerAccessToken();
  const id = String(formData.get("id"));
  try {
    await unconvertLead(token, id);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
  return { ok: true, message: "Lead desconvertido — voltou para a Prospecção" };
}
