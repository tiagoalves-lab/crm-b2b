import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, companyRazaoSocialName } from "@/lib/api/companies";
import { listMemberships } from "@/lib/api/memberships";
import { listOpportunities } from "@/lib/api/opportunities";
import { listPipelines } from "@/lib/api/pipelines";
import { listTasks, taskTypeLabel } from "@/lib/api/tasks";
import type { Membership, Opportunity, Pipeline, Task } from "@/lib/api/types";
import { dayKeyBR, formatPrazoBR } from "@/lib/format-date";
import { ehEtapaDeProposta } from "../pipeline/sla";
import CalendarView from "./calendar-view";
import TarefasTable from "./tarefas-table";
import TopbarFilter from "@/app/_components/topbar-filter";

// Mesmo padrão de tarefas/_detail/detail-body.tsx e dashboard/page.tsx —
// GET /memberships vem enriquecido com nome/login real via Supabase Auth
// Admin API.
function memberDisplayName(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || `${userId.slice(0, 8)}…`;
}

type ViewName = "tabela" | "calendario";

// Vínculo da linha: empresa direta ou a empresa da oportunidade — vem
// embutido em GET /tasks desde 2026-09-04 (antes a tela baixava a base
// inteira de empresas e a lista de oportunidades só pra isto).
function targetLabel(task: Task): string {
  const company = task.company ?? task.opportunity?.company ?? null;
  return company ? companyDisplayName(company) : "—";
}

function dueClass(task: Task): string {
  if (task.status === "done" || !task.dueAt) return "due-ok";
  // Prazo com HORA marcada (2026-09-23, reunião agendada): o instante é
  // real, então a comparação é com o dia calendário em Brasília em que
  // esse instante cai — não dá pra tratá-lo como meia-noite UTC igual ao
  // prazo só-data logo abaixo (uma reunião às 22h viraria "amanhã").
  if (task.dueHasTime) {
    const diaDaReuniao = dayKeyBR(new Date(task.dueAt));
    const hoje = dayKeyBR(new Date());
    if (diaDaReuniao < hoje) return "due-late";
    if (diaDaReuniao === hoje) return "due-today";
    return "due-ok";
  }
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

  // Propostas do Pipeline (2026-09-15) só são buscadas na visão de
  // calendário. Quem não tem permissão de ver oportunidades recebe 403 do
  // backend — aí o calendário mostra só as tarefas, sem derrubar a tela.
  const [{ items: tasks }, memberships, openOpportunities, pipelines] = await Promise.all([
    listTasks(token),
    listMemberships(token),
    currentView === "calendario"
      ? listOpportunities(token, { status: "open" })
          .then((res) => res.items)
          .catch((): Opportunity[] => [])
      : Promise.resolve<Opportunity[]>([]),
    currentView === "calendario"
      ? listPipelines(token)
          .then((res) => res.items)
          .catch((): Pipeline[] => [])
      : Promise.resolve<Pipeline[]>([]),
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
    vinculoLabel: targetLabel(task),
    assigneeLabel: memberDisplayName(task.assigneeUserId, memberships),
    membrosLabel: (task.memberUserIds ?? [])
      .map((id) => memberDisplayName(id, memberships))
      .join(", "),
    dueLabel: task.dueAt ? formatPrazoBR(task.dueAt, task.dueHasTime) : "—",
    dueClass: dueClass(task),
    nAnexos: task._count?.attachments ?? 0,
    nComentarios: task._count?.comments ?? 0,
    tags: task.tags ?? [],
  }));

  // Calendário (client component com arrastar-e-soltar, 2026-09-04):
  // além do título, o card mostra tipo, responsável e cliente. Só
  // pendentes (pedido do usuário, 2026-10-22) — concluída sai da agenda.
  const calendarRows = rows.filter((task) => task.status !== "done").map((task) => ({
    id: task.id,
    title: task.title,
    dueAt: task.dueAt,
    dueHasTime: task.dueHasTime,
    done: task.status === "done",
    tipoLabel: taskTypeLabel(task.tipo),
    assigneeLabel: memberDisplayName(task.assigneeUserId, memberships),
    vinculoLabel: targetLabel(task),
  }));

  // Entra no calendário a oportunidade que já passou das etapas de
  // proposta — Negociação e Fechamento (pedido do usuário, 2026-09-16; as
  // duas listas eram uma só até 2026-10-22) — e toda a que está em Stand
  // by, em qualquer etapa: é pelo calendário que ela volta a ser lembrada.
  const etapaPosProposta = new Set(
    pipelines.flatMap((p) => p.stages.filter((st) => !ehEtapaDeProposta(st)).map((st) => st.id)),
  );
  // Sem previsão de fechamento não há dia pra cair — fica só no quadro.
  const calendarOpportunities = openOpportunities
    .filter(
      (opp) =>
        opp.expectedCloseDate && !opp.deletedAt && (opp.standbyAt || etapaPosProposta.has(opp.stageId)),
    )
    .map((opp) => ({
      id: opp.id,
      version: opp.version,
      standby: Boolean(opp.standbyAt),
      closeDate: opp.expectedCloseDate as string,
      companyLabel: opp.company ? companyRazaoSocialName(opp.company) : "—",
      amountLabel: `${opp.currency} ${Number(opp.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      ownerLabel: memberDisplayName(opp.ownerUserId, memberships),
    }));

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Tarefas</div>
          <div className="page-sub">Rotina consolidada</div>
        </div>
        <TopbarFilter />
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
          <CalendarView tasks={calendarRows} opportunities={calendarOpportunities} month={month} />
        )}
      </div>
    </>
  );
}
