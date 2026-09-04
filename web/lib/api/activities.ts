import { apiFetch } from "./client";
import type { Activity, PaginatedResult } from "./types";

export function listActivities(
  token: string,
  target: { companyId: string } | { opportunityId: string },
): Promise<PaginatedResult<Activity>> {
  const query = new URLSearchParams({ pageSize: "100" });
  if ("companyId" in target) query.set("companyId", target.companyId);
  else query.set("opportunityId", target.opportunityId);
  return apiFetch<PaginatedResult<Activity>>(`/activities?${query.toString()}`, {
    token,
  });
}

// Sem companyId/opportunityId — feed "Últimas atividades" do workspace
// inteiro (Painel comercial, fora do SPEC-CRM-GAMA.md original). Escopado
// por papel no backend (ActivityQueryService#findAll), mesmo critério de
// Company/Opportunity/Task.
export function listRecentActivities(
  token: string,
  options: { pageSize?: number } = {},
): Promise<PaginatedResult<Activity>> {
  const query = new URLSearchParams({ pageSize: String(options.pageSize ?? 12) });
  return apiFetch<PaginatedResult<Activity>>(`/activities?${query.toString()}`, {
    token,
  });
}

// A Timeline da ficha é o histórico de relacionamento com o cliente: só
// o que uma pessoa registrou à mão (Anotação, Ligação, Reunião, Visita,
// E-mail, Pós-venda — os tipos do AddNoteForm, que sempre gravam
// note/call/email com `subtipo`).
//
// O CRM também grava um registro automático a cada empresa criada ou
// alterada (type `field_update`/`stage_change`, sem `subtipo`). Esses são
// trilha de auditoria — alimentam "Últimas atividades" no Painel, onde
// aparecem com texto de verdade ("cadastrou a empresa X") — mas na ficha
// caíam no fallback "nota" do ActivityItem e viravam uma "Anotação" roxa
// em branco, indistinguível de nota escrita por alguém.
//
// Achado 2026-09-04 (relato do usuário: "todos os clientes têm esses dois
// registros"): eram 897 de "empresa criada" (importação do eGestor em
// 06/08) + 302 de "cadastro atualizado" (sanitização de CNPJ em 12-24/08),
// um par em praticamente toda empresa da base. Filtrar aqui resolve pra
// sempre; apagar as linhas não resolveria, porque a próxima edição de
// cadastro criaria outra.
const TIPOS_DE_INTERACAO = new Set<Activity["type"]>(["note", "call", "email"]);

export function apenasInteracoes(activities: Activity[]): Activity[] {
  return activities.filter((a) => TIPOS_DE_INTERACAO.has(a.type));
}

export interface CreateActivityInput {
  companyId?: string;
  opportunityId?: string;
  type: "note" | "call" | "email";
  texto: string;
  subtipo?: string;
  contactId?: string;
}

export function createActivity(
  token: string,
  input: CreateActivityInput,
): Promise<Activity> {
  return apiFetch<Activity>("/activities", { method: "POST", token, body: input });
}

// Subtipos que exigem contato (pedido direto do usuário, 2026-08-05) —
// mesma lista de CONTACT_REQUIRED_TASK_TYPES (web/lib/api/tasks.ts) e do
// backend (src/activities/activity-subtipo.constants.ts), mantida à mão
// aqui (sem tipos compartilhados entre os dois projetos npm, mesmo padrão
// de sempre neste repo).
export const CONTACT_REQUIRED_ACTIVITY_SUBTIPOS = ["ligacao", "reuniao", "visita", "email"];
