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
    if (task.companyId) return `📈 ${companyName(task.companyId)}`;
    if (task.opportunityId) {
      const opp = opportunities.find((o) => o.id === task.opportunityId);
      return `📈 ${opp ? companyName(opp.companyId) : "—"}`;
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
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Painel comercial</div>
          <div className="page-sub">Visão geral da carteira</div>
        </div>
      </div>

      <div className="content">
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Pipeline em aberto</div>
            <div className="stat-value">{brl(totalAberto)}</div>
            <div className="kpi-delta up">▲ {abertas.length} oportunidades ativas</div>
          </div>
          <div className="stat-tile blue">
            <div className="stat-label">Previsão ponderada</div>
            <div className="stat-value">{brl(ponderado)}</div>
            <div className="kpi-delta">valor × probabilidade</div>
          </div>
          <div className="stat-tile green">
            <div className="stat-label">Ganho no mês</div>
            <div className="stat-value">{brl(ganhoNoMes)}</div>
            <div className="kpi-delta up">▲ {ganhasNoMes.length} fechada(s)</div>
          </div>
          <Link href="/dashboard/leads" className="stat-tile purple" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
            <div className="stat-label">Fila de triagem</div>
            <div className="stat-value">{leadsNovos.length}</div>
            <div className={leadsNovos.length > 0 ? "kpi-delta down" : "kpi-delta"}>
              {leadsNovos.length > 0 ? "⚠ leads a qualificar" : "fila zerada"}
            </div>
          </Link>
        </div>

        {pipeline && (
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M18 9l-5 5-3-3-4 4" />
                </svg>
                Funil de propostas — resumo
              </div>
              <Link href="/dashboard/pipeline" className="btn btn-sm btn-ghost">
                Abrir pipeline →
              </Link>
            </div>
            <div className="panel-body">
              <div className="funnel-bar">
                {funil.map((f) => (
                  <div className="fbar" key={f.stage.id}>
                    <div className="fbar-label">{f.stage.name}</div>
                    <div className="fbar-track">
                      <div className="fbar-fill" style={{ width: `${Math.max((f.valor / maxFunilValor) * 100, 3)}%` }}>
                        {f.count} deal(s)
                      </div>
                    </div>
                    <div className="fbar-val">{brl(f.valor)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              Ações de hoje
            </div>
            <Link href="/dashboard/tarefas" className="btn btn-sm btn-ghost">
              Ver todas →
            </Link>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <table>
              <tbody>
                {tarefasHoje.map((task) => (
                  <tr key={task.id}>
                    <td className="t-co">{task.title}</td>
                    <td className="t-sub">{targetLabel(task)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`task-due ${isOverdue(task) ? "due-late" : "due-today"}`}>
                        {isOverdue(task) ? "atrasada" : "hoje"}
                      </span>
                    </td>
                    <td style={{ width: 60, textAlign: "right" }}>
                      <form action={completeTaskAction}>
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="back" value="/dashboard" />
                        <button type="submit" className="btn btn-sm">
                          Feita
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {tarefasHoje.length === 0 && (
                  <tr>
                    <td className="empty">Nenhuma ação pendente para hoje 🎉</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
