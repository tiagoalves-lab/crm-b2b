import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listPipelines } from "@/lib/api/pipelines";
import type { Opportunity } from "@/lib/api/types";
import {
  createOpportunityAction,
  createPipelineAction,
  createStageAction,
  reopenAction,
} from "./actions";
import CompanyPicker from "./company-picker";
import PipelineBoard from "./pipeline-board";

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  won: "Ganho",
  lost: "Perdido",
};

function brl(value: number, currency = "BRL"): string {
  return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

// "2026-07" -> [primeiro dia, primeiro dia do mês seguinte) — comparação
// por intervalo half-open evita problema de fuso em comparação por string.
function monthRange(mes: string): { start: Date; end: Date } {
  const [y, m] = mes.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(mes: string): string {
  const { start } = monthRange(mes);
  return start.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mes?: string }>;
}) {
  const { error, mes } = await searchParams;
  const token = await getServerAccessToken();
  const [me, { items: pipelines }, { items: companies }, { items: opportunities }] =
    await Promise.all([
      getMe(token),
      listPipelines(token),
      listCompanies(token),
      listOpportunities(token),
    ]);

  const canManagePipeline =
    me.membership.role === "owner" || me.membership.role === "admin";
  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  if (!pipeline) {
    return (
      <div className="content">
        <div className="panel-head">
          <h2>Pipeline</h2>
          <p className="sub">Nenhum pipeline configurado ainda.</p>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {canManagePipeline ? (
          <div className="form-panel">
            <form action={createPipelineAction} className="form-grid">
              <label>
                Nome do pipeline*
                <input name="name" required defaultValue="Funil Padrão" />
              </label>
              <button type="submit" className="btn btn-primary">
                Criar pipeline
              </button>
            </form>
          </div>
        ) : (
          <div className="empty-state">
            Peça a um owner/admin pra criar o pipeline de vendas.
          </div>
        )}
      </div>
    );
  }

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "—";

  const pipelineOpps = opportunities.filter(
    (o) => o.pipelineId === pipeline.id && !o.deletedAt,
  );
  const openOpps = pipelineOpps.filter((o) => o.status === "open");
  const wonOpps = pipelineOpps.filter((o) => o.status === "won");
  const lostOpps = pipelineOpps.filter((o) => o.status === "lost");

  // Previsão ponderada = Σ(amount × probability/100) das oportunidades
  // abertas (SPEC-CRM-GAMA.md §4.2).
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const previsaoPonderada = openOpps.reduce((sum, o) => {
    const prob = stageById.get(o.stageId)?.probability ?? 0;
    return sum + Number(o.amount) * (prob / 100);
  }, 0);

  const taxaFechamentoGlobal =
    wonOpps.length + lostOpps.length > 0
      ? Math.round((wonOpps.length / (wonOpps.length + lostOpps.length)) * 100)
      : 0;

  // Subform de encerradas — filtro de período por closedAt, mês corrente
  // por padrão, navegação por mês.
  const currentMes = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : currentMonth();
  const { start: mesStart, end: mesEnd } = monthRange(currentMes);
  const encerradas = [...wonOpps, ...lostOpps]
    .filter((o) => o.closedAt && new Date(o.closedAt) >= mesStart && new Date(o.closedAt) < mesEnd)
    .sort((a, b) => new Date(b.closedAt ?? 0).getTime() - new Date(a.closedAt ?? 0).getTime());
  const wonNoMes = encerradas.filter((o) => o.status === "won").length;
  const lostNoMes = encerradas.filter((o) => o.status === "lost").length;
  const taxaFechamentoMes =
    wonNoMes + lostNoMes > 0 ? Math.round((wonNoMes / (wonNoMes + lostNoMes)) * 100) : 0;

  const mesHref = (m: string) => `/dashboard/pipeline?mes=${m}`;

  return (
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Pipeline — {pipeline.name}</h2>
          <p className="sub">{openOpps.length} oportunidade(s) em aberto</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Previsão ponderada</div>
          <div className="stat-value">{brl(previsaoPonderada)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Taxa de fechamento</div>
          <div className="stat-value">{taxaFechamentoGlobal}%</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Ganhas / encerradas</div>
          <div className="stat-value">
            {wonOpps.length} / {wonOpps.length + lostOpps.length}
          </div>
        </div>
      </div>

      <div className="form-panel">
        <form action={createOpportunityAction} className="form-grid">
          <input type="hidden" name="pipelineId" value={pipeline.id} />
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ marginBottom: 4, display: "block" }}>Empresa*</label>
            <CompanyPicker />
          </div>
          <label>
            Stage*
            <select name="stageId" required defaultValue={stages[0]?.id ?? ""}>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valor*
            <input name="amount" type="number" step="0.01" min="0" required />
          </label>
          <label>
            Moeda
            <input name="currency" defaultValue="BRL" maxLength={3} />
          </label>
          <label>
            Previsão de fechamento
            <input name="expectedCloseDate" type="date" />
          </label>
          <button type="submit" className="btn btn-primary">
            Nova oportunidade
          </button>
        </form>
      </div>

      {canManagePipeline && (
        <details style={{ marginBottom: 16 }}>
          <summary
            style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}
          >
            + Adicionar stage a este pipeline
          </summary>
          <div className="form-panel" style={{ marginTop: 8 }}>
            <form action={createStageAction} className="form-grid">
              <input type="hidden" name="pipelineId" value={pipeline.id} />
              <label>
                Nome*
                <input name="name" required minLength={2} maxLength={60} />
              </label>
              <label>
                Ordem*
                <input name="order" type="number" required defaultValue={stages.length + 1} />
              </label>
              <label>
                Probabilidade (%)*
                <input
                  name="probability"
                  type="number"
                  min="0"
                  max="100"
                  required
                  defaultValue={50}
                />
              </label>
              <button type="submit" className="btn btn-primary">
                Adicionar stage
              </button>
            </form>
          </div>
        </details>
      )}

      <PipelineBoard stages={stages} openOpportunities={openOpps} companies={companies} />

      <div className="toolbar" style={{ marginTop: 28 }}>
        <div className="panel-head">
          <h3 style={{ fontSize: 15 }}>Encerradas — {monthLabel(currentMes)}</h3>
          <p className="sub">
            {wonNoMes} ganha(s) · {lostNoMes} perdida(s) · {taxaFechamentoMes}% de fechamento no mês
          </p>
        </div>
        <div className="row-form">
          <Link href={mesHref(shiftMonth(currentMes, -1))} className="btn btn-ghost btn-sm">
            ← Mês anterior
          </Link>
          <Link href={mesHref(currentMonth())} className="btn btn-ghost btn-sm">
            Mês atual
          </Link>
          <Link href={mesHref(shiftMonth(currentMes, 1))} className="btn btn-ghost btn-sm">
            Próximo mês →
          </Link>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Empresa</th>
            <th>Valor</th>
            <th>Status</th>
            <th>Fechamento</th>
            <th>Motivo</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {encerradas.map((opp: Opportunity) => (
            <tr key={opp.id}>
              <td>{companyName(opp.companyId)}</td>
              <td>{brl(Number(opp.amount), opp.currency)}</td>
              <td>
                <span className={opp.status === "won" ? "badge badge-accent" : "badge badge-danger"}>
                  {STATUS_LABEL[opp.status]}
                </span>
              </td>
              <td>{opp.closedAt ? new Date(opp.closedAt).toLocaleDateString("pt-BR") : "—"}</td>
              <td>{opp.lostReason ?? "—"}</td>
              <td>
                <form action={reopenAction}>
                  <input type="hidden" name="id" value={opp.id} />
                  <input type="hidden" name="version" value={opp.version} />
                  <button type="submit" className="btn btn-sm">
                    Reabrir
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {encerradas.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                Nenhuma oportunidade encerrada nesse período.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
