import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { listOpportunities } from "@/lib/api/opportunities";
import { listTasks } from "@/lib/api/tasks";
import type { Task } from "@/lib/api/types";
import {
  completeTaskAction,
  createTaskAction,
  deleteTaskAction,
  reopenTaskAction,
} from "./actions";

export default async function TarefasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; overdue?: string }>;
}) {
  const { error, overdue } = await searchParams;
  const token = await getServerAccessToken();
  const showOverdueOnly = overdue === "1";
  const [{ items: tasks }, { items: companies }, { items: contacts }, { items: opportunities }] =
    await Promise.all([
      listTasks(token, showOverdueOnly ? { overdue: true } : {}),
      listCompanies(token),
      listContacts(token),
      listOpportunities(token),
    ]);

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
        <Link
          href={showOverdueOnly ? "/dashboard/tarefas" : "/dashboard/tarefas?overdue=1"}
          className="btn btn-ghost btn-sm"
        >
          {showOverdueOnly ? "Ver todas" : "Ver só vencidas"}
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-panel">
        <form action={createTaskAction} className="form-grid">
          <label>
            Título*
            <input name="title" required />
          </label>
          <label>
            Prazo
            <input name="dueAt" type="date" />
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
              <td>{task.title}</td>
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
                    <button type="submit" className="btn btn-sm btn-primary">
                      Concluir
                    </button>
                  </form>
                ) : (
                  <form action={reopenTaskAction}>
                    <input type="hidden" name="id" value={task.id} />
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
    </div>
  );
}
