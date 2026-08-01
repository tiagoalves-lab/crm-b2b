import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listTasks } from "@/lib/api/tasks";
import type { Company, Task } from "@/lib/api/types";
import { completeTaskAction, reopenTaskAction } from "./actions";
import CalendarView from "./calendar-view";

type ViewName = "tabela" | "calendario";

function targetLabel(
  task: Task,
  companies: Company[],
  opportunities: { id: string; companyId: string; deletedAt: string | null }[],
): string {
  if (task.companyId) {
    const company = companies.find((c) => c.id === task.companyId);
    return `📈 ${company ? companyDisplayName(company) : "—"}`;
  }
  if (task.opportunityId) {
    const opp = opportunities.find((o) => o.id === task.opportunityId);
    const company = opp ? companies.find((c) => c.id === opp.companyId) : null;
    return `📈 ${company ? companyDisplayName(company) : "—"}`;
  }
  return "—";
}

function dueClass(task: Task): string {
  if (task.status === "done" || !task.dueAt) return "due-ok";
  const due = new Date(task.dueAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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

  const [{ items: tasks }, { items: companies }, { items: opportunities }] = await Promise.all([
    listTasks(token),
    listCompanies(token),
    listOpportunities(token),
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
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Tarefa</th>
                  <th>Vínculo</th>
                  <th>Prazo</th>
                  <th>Situação</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => {
                  const done = task.status === "done";
                  const nAnexos = task._count?.attachments ?? 0;
                  const nCom = task._count?.comments ?? 0;
                  return (
                    <tr key={task.id} className="row-clickable">
                      <td>
                        <form action={done ? reopenTaskAction : completeTaskAction}>
                          <input type="hidden" name="id" value={task.id} />
                          <input type="hidden" name="back" value={baseHref} />
                          <button
                            type="submit"
                            className={done ? "task-check done" : "task-check"}
                            aria-label={done ? "Reabrir" : "Concluir"}
                          >
                            {done && (
                              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            )}
                          </button>
                        </form>
                      </td>
                      <td>
                        <Link href={`/dashboard/tarefas/${task.id}`} className={done ? "task-title-cell done" : "task-title-cell"}>
                          {task.title}
                        </Link>
                        {nAnexos > 0 && (
                          <span className="attach-count" title="Anexos">
                            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                            </svg>
                            {nAnexos}
                          </span>
                        )}
                        {nCom > 0 && (
                          <span className="attach-count" title="Comentários">
                            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                            </svg>
                            {nCom}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="t-sub">{targetLabel(task, companies, opportunities)}</span>
                      </td>
                      <td>
                        <span className={`task-due ${dueClass(task)}`} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                          {task.dueAt ? new Date(task.dueAt).toLocaleDateString("pt-BR") : "—"}
                        </span>
                      </td>
                      <td>
                        <span className={done ? "pill pill-green" : "pill pill-gray"}>{done ? "Concluída" : "Pendente"}</span>
                      </td>
                      <td>
                        <div className="cell-actions">
                          <Link href={`/dashboard/tarefas/${task.id}/editar`} className="icon-btn" title="Editar">
                            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Nenhuma tarefa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <CalendarView tasks={tasks} month={month} />
        )}
      </div>
    </>
  );
}
