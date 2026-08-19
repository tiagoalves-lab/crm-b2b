import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { buildCompanyLookup, companyDisplayName, listCompanies } from "@/lib/api/companies";
import { listMemberships } from "@/lib/api/memberships";
import { listOpportunities } from "@/lib/api/opportunities";
import { listTasks, taskTypeLabel } from "@/lib/api/tasks";
import type { Company, Membership, Task } from "@/lib/api/types";
import { dayKeyBR, formatDateBR } from "@/lib/format-date";
import CalendarView from "./calendar-view";
import TarefasTable from "./tarefas-table";

// Mesmo padrão de tarefas/_detail/detail-body.tsx e dashboard/page.tsx —
// GET /memberships vem enriquecido com nome/login real via Supabase Auth
// Admin API.
function memberDisplayName(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || `${userId.slice(0, 8)}…`;
}

type ViewName = "tabela" | "calendario";

function targetLabel(
  task: Task,
  companyMap: Map<string, Company>,
  opportunities: { id: string; companyId: string; deletedAt: string | null }[],
): string {
  if (task.companyId) {
    const company = companyMap.get(task.companyId);
    return company ? companyDisplayName(company) : "—";
  }
  if (task.opportunityId) {
    const opp = opportunities.find((o) => o.id === task.opportunityId);
    const company = opp ? companyMap.get(opp.companyId) : undefined;
    return company ? companyDisplayName(company) : "—";
  }
  return "—";
}

function dueClass(task: Task): string {
  if (task.status === "done" || !task.dueAt) return "due-ok";
  const due = new Date(task.dueAt);
  // Achado 2026-08-13: `today.setHours(0,0,0,0)` usava o fuso LOCAL de
  // onde o código roda — na Vercel isso é UTC, então perto da virada do
  // dia em Brasília (21h-23h59) o servidor já achava que "hoje" era
  // amanhã, marcando tarefa como atrasada 3h cedo demais. `dueAt` é
  // meia-noite UTC representando um dia sem hora (input type="date",
  // mesmo padrão de calendar-view.tsx#dueDateKey) — comparamos com
  // "hoje" calculado no dia calendário de Brasília, também como meia-
  // noite UTC, pra bater com o mesmo referencial.
  const today = new Date(`${dayKeyBR(new Date())}T00:00:00.000Z`);
  if (due < today) return "due-late";
  if (due.getTime() === today.getTime()) return "due-today";
  return "due-ok";
}

export default async function TarefasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; view?: string; month?: string }>;
}) {
  const { error, view, month } = await searchParams;
  const token = await getServerAccessToken();
  const currentView: ViewName = view === "calendario" ? "calendario" : "tabela";

  const [{ items: tasks }, { items: companies }, { items: opportunities }, memberships] = await Promise.all([
    listTasks(token),
    listCompanies(token),
    listOpportunities(token),
    listMemberships(token),
  ]);

  // Empresa com a tag "lead-triagem" não vem em GET /companies, mas uma
  // tarefa pode apontar pra ela (criada antes da aprovação do lead) — sem
  // o preenchimento individual o Vínculo sumia. Lógica compartilhada com o
  // Painel desde 2026-08-13, ver buildCompanyLookup.
  const referencedOpportunityIds = new Set(
    tasks.map((t) => t.opportunityId).filter((id): id is string => !!id),
  );
  const companyMap = await buildCompanyLookup(token, companies, [
    ...tasks.map((t) => t.companyId),
    ...opportunities
      .filter((o) => referencedOpportunityIds.has(o.id))
      .map((o) => o.companyId),
  ]);

  const baseHref = `/dashboard/tarefas?view=${currentView}${month ? `&month=${month}` : ""}`;
  const viewHref = (v: ViewName) => `/dashboard/tarefas?view=${v}${month && v === "calendario" ? `&month=${month}` : ""}`;

  // Ordena: pendentes com prazo mais próximo primeiro (atrasadas no topo),
  // concluídas no fim — protótipo ordena por status+prazo; nosso schema só
  // tem pending/done (sem os 4 status fictícios do protótipo).
  const rows = [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "done" ? 1 : -1;
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  });

  // TarefasTable é client component (precisa de onClick pra linha
  // inteira abrir a ficha) — só dados simples atravessam a fronteira,
  // sem Map/função (nada de RSC serializar tipo não-plano).
  const tableRows = rows.map((task) => ({
    id: task.id,
    title: task.title,
    done: task.status === "done",
    tipoLabel: taskTypeLabel(task.tipo),
    vinculoLabel: targetLabel(task, companyMap, opportunities),
    assigneeLabel: memberDisplayName(task.assigneeUserId, memberships),
    dueLabel: task.dueAt ? formatDateBR(task.dueAt) : "—",
    dueClass: dueClass(task),
    nAnexos: task._count?.attachments ?? 0,
    nComentarios: task._count?.comments ?? 0,
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Tarefas</div>
          <div className="page-sub">Rotina consolidada</div>
        </div>
        <Link href="/dashboard/tarefas/nova" className="btn btn-primary">
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nova tarefa
        </Link>
      </div>

      <div className="content">
        <div className="toolbar">
          <div className="seg">
            <Link href={viewHref("tabela")} className={currentView === "tabela" ? "active" : undefined}>
              Tabela
            </Link>
            <Link href={viewHref("calendario")} className={currentView === "calendario" ? "active" : undefined}>
              Calendário
            </Link>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {tasks.filter((t) => t.status !== "done").length} abertas · clique para abrir
          </span>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {currentView === "tabela" ? (
          <TarefasTable rows={tableRows} baseHref={baseHref} />
        ) : (
          <CalendarView tasks={tasks} month={month} />
        )}
      </div>
    </>
  );
}
