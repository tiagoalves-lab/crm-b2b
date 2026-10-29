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

// Exceção à régua acima (pedido do usuário, 2026-10-28): a conversão do
// lead — e o desfazer dela — entra na Timeline, com quem fez e quando. É
// marco do relacionamento, não auditoria de cadastro. Fica fora dos
// contadores de "Interações" e da "Última atividade", que continuam
// contando só o que uma pessoa registrou.
const ACOES_DE_CONVERSAO = new Set(["lead_approved", "lead_unconverted"]);

export function ehConversao(activity: Activity): boolean {
  const action = (activity.payload as { action?: unknown } | null)?.action;
  return typeof action === "string" && ACOES_DE_CONVERSAO.has(action);
}

export function timelineDaFicha(activities: Activity[]): Activity[] {
  return activities.filter((a) => TIPOS_DE_INTERACAO.has(a.type) || ehConversao(a));
}

// Texto da linha de conversão na Timeline. Sem `origem` (registros de
// antes de 2026-10-28) é o "Aprovar" da Prospecção.
export function textoDaConversao(activity: Activity): string {
  const payload = activity.payload as { action?: string; origem?: string };
  if (payload.action === "lead_unconverted") return "Conversão do lead desfeita";
  if (payload.origem === "oportunidade") return "Lead convertido ao abrir oportunidade";
  if (payload.origem === "cotacoes") return "Lead convertido pelo app de cotações";
  return "Lead convertido";
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
