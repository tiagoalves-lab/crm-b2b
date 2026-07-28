import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listCompanies } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { listMemberships } from "@/lib/api/memberships";
import { listOpportunities } from "@/lib/api/opportunities";
import { listTaskLists } from "@/lib/api/task-lists";
import { getTask, listTasks } from "@/lib/api/tasks";
import type { Task } from "@/lib/api/types";
import {
  completeTaskAction,
  createTaskAction,
  createTaskListAction,
  deleteTaskAction,
  deleteTaskListAction,
  reopenTaskAction,
} from "./actions";
import CalendarView from "./calendar-view";
import KanbanBoard from "./kanban-board";
import TaskDetail from "./task-detail";

type ViewName = "lista" | "kanban" | "calendario";
const VIEWS: Array<{ key: ViewName; label: string }> = [
  { key: "lista", label: "Lista" },
  { key: "kanban", label: "Kanban" },
  { key: "calendario", label: "Calendário" },
];

export default async function TarefasPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    overdue?: string;
    view?: string;
    card?: string;
    month?: string;
  }>;
}) {
  const { error, overdue, view, card, month } = await searchParams;
  const token = await getServerAccessToken();
  const showOverdueOnly = overdue === "1";
  const currentView: ViewName =
    view === "kanban" || view === "calendario" ? view : "lista";

  const [me, { items: tasks }, taskLists, { items: companies }, { items: contacts }, { items: opportunities }, members] =
    await Promise.all([
      getMe(token),
      listTasks(token, showOverdueOnly ? { overdue: true } : {}),
      listTaskLists(token),
      listCompanies(token),
      listContacts(token),
      listOpportunities(token),
      listMemberships(token),
    ]);

  const canManageLists = me.membership.role === "owner" || me.membership.role === "admin";
  const viewHref = (v: ViewName) =>
    `/dashboard/tarefas?view=${v}${month && v === "calendario" ? `&month=${month}` : ""}`;
  const baseHref = `/dashboard/tarefas?view=${currentView}${month ? `&month=${month}` : ""}`;

  if (card) {
    const detail = await getTask(token, card);
    return (
      <TaskDetail
        task={detail}
        backHref={baseHref}
        companies={companies}
        contacts={contacts}
        opportunities={opportunities}
        members={members}
        currentUserId={me.user.id}
        error={error}
      />
    );
  }

  const targetLabel = (task: Task) => {
    if (task.companyId) {
      return `Empresa: ${companies.find((c) => c.id === task.companyId)?.name ?? "—"}`;
    }
    if (task.contactId) {
      return `Contato: ${contacts.find((c) => c.id === task.contactId)?.name ?? "—"}`;
    }
    if (task.opportunityId) {
      const opp = opportunities.find((o) => o.id === task.opportunityId);
      const company = opp ? companies.find((c) => c.id === opp.companyId) : null;
      return `Oportunidade: ${company?.name ?? "—"}`;
    }
    return "—";
  };

  const isOverdue = (task: Task) =>
    task.status === "pending" && task.dueAt !== null && new Date(task.dueAt) < new Date();

  return (
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Tarefas</h2>
          <p className="sub">
            {tasks.length} tarefa(s){showOverdueOnly ? " vencidas" : ""}
          </p>
        </div>
        <div className="row-form">
          <div className="view-tabs">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={viewHref(v.key)}
                className={v.key === currentView ? "view-tab active" : "view-tab"}
              >
                {v.label}
              </Link>
            ))}
          </div>
          {currentView === "lista" && (
            <Link
              href={showOverdueOnly ? "/dashboard/tarefas" : "/dashboard/tarefas?overdue=1"}
              className="btn btn-ghost btn-sm"
            >
              {showOverdueOnly ? "Ver todas" : "Ver só vencidas"}
            </Link>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {currentView !== "calendario" && (
        <div className="form-panel">
          <form action={createTaskAction} className="form-grid">
            <input type="hidden" name="back" value={baseHref} />
            <label>
              Título*
              <input name="title" required />
            </label>
            <label>
              Prazo
              <input name="dueAt" type="date" />
            </label>
            <label>
              Coluna
              <select name="listId" defaultValue={taskLists.find((l) => l.order === 0)?.id ?? ""}>
                {[...taskLists]
                  .sort((a, b) => a.order - b.order)
                  .map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Empresa
              <select name="companyId" defaultValue="">
                <option value="">—</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Contato
              <select name="contactId" defaultValue="">
                <option value="">—</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Oportunidade
              <select name="opportunityId" defaultValue="">
                <option value="">—</option>
                {opportunities
                  .filter((opp) => !opp.deletedAt)
                  .map((opp) => (
                    <option key={opp.id} value={opp.id}>
                      {companies.find((c) => c.id === opp.companyId)?.name ?? opp.id} —{" "}
                      {opp.currency} {Number(opp.amount).toLocaleString("pt-BR")}
                    </option>
                  ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary">
              Nova tarefa
            </button>
          </form>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8 }}>
            Escolha exatamente um vínculo (empresa, contato OU oportunidade).
          </p>
        </div>
      )}

      {currentView === "kanban" && canManageLists && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
            + Gerenciar colunas do quadro
          </summary>
          <div className="form-panel" style={{ marginTop: 8 }}>
            <form action={createTaskListAction} className="form-grid">
              <input type="hidden" name="back" value={baseHref} />
              <label>
                Nome*
                <input name="name" required />
              </label>
              <label>
                Ordem*
                <input name="order" type="number" required defaultValue={taskLists.length} />
              </label>
              <label className="row-form" style={{ alignItems: "center" }}>
                <input type="checkbox" name="isDoneList" style={{ width: "auto" }} />
                É coluna de &ldquo;concluída&rdquo;
              </label>
              <button type="submit" className="btn btn-primary">
                Adicionar coluna
              </button>
            </form>
            <table className="data-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Coluna</th>
                  <th>Ordem</th>
                  <th>Concluída?</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {[...taskLists]
                  .sort((a, b) => a.order - b.order)
                  .map((list) => (
                    <tr key={list.id}>
                      <td>{list.name}</td>
                      <td>{list.order}</td>
                      <td>{list.isDoneList ? "Sim" : "Não"}</td>
                      <td>
                        <form action={deleteTaskListAction}>
                          <input type="hidden" name="id" value={list.id} />
                          <input type="hidden" name="back" value={baseHref} />
                          <button type="submit" className="btn btn-sm btn-danger">
                            Remover
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {currentView === "lista" && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Vínculo</th>
              <th>Prazo</th>
              <th>Status</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <Link href={`${baseHref}&card=${task.id}`}>{task.title}</Link>
                </td>
                <td>{targetLabel(task)}</td>
                <td>
                  {task.dueAt ? new Date(task.dueAt).toLocaleDateString("pt-BR") : "—"}
                  {isOverdue(task) && (
                    <span className="badge badge-danger" style={{ marginLeft: 6 }}>
                      vencida
                    </span>
                  )}
                </td>
                <td>
                  <span className={task.status === "done" ? "badge badge-accent" : "badge"}>
                    {task.status === "done" ? "Concluída" : "Pendente"}
                  </span>
                </td>
                <td className="row-form">
                  {task.status === "pending" ? (
                    <form action={completeTaskAction}>
                      <input type="hidden" name="id" value={task.id} />
                      <input type="hidden" name="back" value={baseHref} />
                      <button type="submit" className="btn btn-sm btn-primary">
                        Concluir
                      </button>
                    </form>
                  ) : (
                    <form action={reopenTaskAction}>
                      <input type="hidden" name="id" value={task.id} />
                      <input type="hidden" name="back" value={baseHref} />
                      <button type="submit" className="btn btn-sm">
                        Reabrir
                      </button>
                    </form>
                  )}
                  <form action={deleteTaskAction}>
                    <input type="hidden" name="id" value={task.id} />
                    <button type="submit" className="btn btn-sm btn-danger">
                      Excluir
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                  Nenhuma tarefa.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {currentView === "kanban" && (
        <KanbanBoard
          lists={taskLists}
          tasks={tasks}
          companies={companies}
          contacts={contacts}
          opportunities={opportunities}
          baseHref={baseHref}
        />
      )}

      {currentView === "calendario" && (
        <CalendarView tasks={tasks} month={month} baseHref={baseHref} />
      )}
    </div>
  );
}
