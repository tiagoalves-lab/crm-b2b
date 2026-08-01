import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listPipelines } from "@/lib/api/pipelines";
import { listRawLeads } from "@/lib/api/raw-leads";
import { listTasks } from "@/lib/api/tasks";
import type { Task } from "@/lib/api/types";
import { completeTaskAction } from "./tarefas/actions";

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Painel comercial (SPEC-CRM-GAMA.md §4.5) — tudo derivado das mesmas
// listagens que Pipeline/Tarefas/Leads já usam, sem endpoint novo.
export default async function DashboardPage() {
  const token = await getServerAccessToken();
  const [{ items: pipelines }, { items: opportunities }, { items: tasks }, { items: companies }, { items: leadsNovos }] =
    await Promise.all([
      listPipelines(token),
      listOpportunities(token),
      listTasks(token),
      listCompanies(token),
      listRawLeads(token, { status: "novo" }),
    ]);

  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const stageById = new Map((pipeline?.stages ?? []).map((s) => [s.id, s]));

  const abertas = opportunities.filter((o) => o.status === "open" && !o.deletedAt);
  const totalAberto = abertas.reduce((s, o) => s + Number(o.amount), 0);
  const ponderado = abertas.reduce((s, o) => {
    const prob = stageById.get(o.stageId)?.probability ?? 0;
    return s + Number(o.amount) * (prob / 100);
  }, 0);

  const mesInicio = startOfMonth();
  const ganhasNoMes = opportunities.filter(
    (o) => o.status === "won" && o.closedAt && new Date(o.closedAt) >= mesInicio,
  );
  const ganhoNoMes = ganhasNoMes.reduce((s, o) => s + Number(o.amount), 0);

  const hojeInicio = startOfToday();
  const hojeFim = endOfToday();
  const tarefasHoje = tasks.filter(
    (t) => t.status === "pending" && t.dueAt !== null && new Date(t.dueAt) <= hojeFim,
  );

  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? "—";
  const targetLabel = (task: Task) => {
    if (task.companyId) return `Empresa: ${companyName(task.companyId)}`;
    if (task.opportunityId) {
      const opp = opportunities.find((o) => o.id === task.opportunityId);
      return `Oportunidade: ${opp ? companyName(opp.companyId) : "—"}`;
    }
    return "—";
  };
  const isOverdue = (task: Task) => task.dueAt !== null && new Date(task.dueAt) < hojeInicio;

  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
  const funil = stages.map((stage) => {
    const deals = abertas.filter((o) => o.stageId === stage.id);
    return { stage, count: deals.length, valor: deals.reduce((s, o) => s + Number(o.amount), 0) };
  });
  const maxFunilValor = Math.max(...funil.map((f) => f.valor), 1);

  return (
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Painel comercial</h2>
          <p className="sub">Visão geral da carteira</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Pipeline em aberto</div>
          <div className="stat-value">{brl(totalAberto)}</div>
          <div className="sub">{abertas.length} oportunidade(s) ativa(s)</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Previsão ponderada</div>
          <div className="stat-value">{brl(ponderado)}</div>
          <div className="sub">valor × probabilidade</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Ganho no mês</div>
          <div className="stat-value">{brl(ganhoNoMes)}</div>
          <div className="sub">{ganhasNoMes.length} fechada(s)</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Fila de triagem</div>
          <div className="stat-value">{leadsNovos.length}</div>
          <div className="sub">
            {leadsNovos.length > 0 ? (
              <Link href="/dashboard/leads">leads a qualificar →</Link>
            ) : (
              "fila zerada"
            )}
          </div>
        </div>
      </div>

      {pipeline && (
        <div className="toolbar" style={{ marginTop: 20 }}>
          <div className="panel-head">
            <h3 style={{ fontSize: 15 }}>Funil de propostas — resumo</h3>
          </div>
          <Link href="/dashboard/pipeline" className="btn btn-ghost btn-sm">
            Abrir pipeline →
          </Link>
        </div>
      )}
      {pipeline && (
        <table className="data-table">
          <tbody>
            {funil.map((f) => (
              <tr key={f.stage.id}>
                <td style={{ width: "30%" }}>{f.stage.name}</td>
                <td>
                  <div style={{ background: "var(--surface-sunken)", borderRadius: 4, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.max((f.valor / maxFunilValor) * 100, 3)}%`,
                        background: "var(--accent)",
                        color: "#fff",
                        fontSize: 12,
                        padding: "4px 8px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.count} deal(s)
                    </div>
                  </div>
                </td>
                <td style={{ width: 140, textAlign: "right" }}>{brl(f.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3 style={{ fontSize: 15 }}>Ações de hoje</h3>
        </div>
        <Link href="/dashboard/tarefas" className="btn btn-ghost btn-sm">
          Ver todas →
        </Link>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Tarefa</th>
            <th>Vínculo</th>
            <th>Prazo</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {tarefasHoje.map((task) => (
            <tr key={task.id}>
              <td>{task.title}</td>
              <td>{targetLabel(task)}</td>
              <td>
                {task.dueAt ? new Date(task.dueAt).toLocaleDateString("pt-BR") : "—"}
                {isOverdue(task) && (
                  <span className="badge badge-danger" style={{ marginLeft: 6 }}>
                    atrasada
                  </span>
                )}
              </td>
              <td>
                <form action={completeTaskAction}>
                  <input type="hidden" name="id" value={task.id} />
                  <input type="hidden" name="back" value="/dashboard" />
                  <button type="submit" className="btn btn-sm btn-primary">
                    Feita
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {tarefasHoje.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                Nenhuma ação pendente para hoje 🎉
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
