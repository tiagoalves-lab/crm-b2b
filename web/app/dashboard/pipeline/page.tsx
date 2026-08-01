import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listPipelines } from "@/lib/api/pipelines";
import type { Opportunity } from "@/lib/api/types";
import { createPipelineAction, createStageAction } from "./actions";
import PipelineBoard from "./pipeline-board";

function brl(value: number, currency = "BRL"): string {
  return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
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
  searchParams: Promise<{ error?: string; mes?: string; periodo?: string; ini?: string; fim?: string }>;
}) {
  const { error, mes, periodo, ini, fim } = await searchParams;
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
      <>
        <div className="topbar">
          <div>
            <div className="page-title">Pipeline de Oportunidades</div>
            <div className="page-sub">Ciclo de vida da venda</div>
          </div>
        </div>
        <div className="content">
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
            <div className="empty-state">Peça a um owner/admin pra criar o pipeline de vendas.</div>
          )}
        </div>
      </>
    );
  }

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "—";

  const pipelineOpps = opportunities.filter((o) => o.pipelineId === pipeline.id && !o.deletedAt);
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

  // Subform de encerradas — filtro de período por closedAt: navegação por
  // mês (default) ou range customizado (protótipo: closedPeriod).
  const isCustom = periodo === "custom";
  const currentMes = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : currentMonth();
  let periodStart: Date;
  let periodEnd: Date;
  if (isCustom) {
    const { start: defStart, end: defEnd } = monthRange(currentMes);
    periodStart = ini ? new Date(`${ini}T00:00:00Z`) : defStart;
    periodEnd = fim ? new Date(`${fim}T23:59:59Z`) : defEnd;
  } else {
    const { start, end } = monthRange(currentMes);
    periodStart = start;
    periodEnd = end;
  }

  const encerradas = [...wonOpps, ...lostOpps]
    .filter((o) => o.closedAt && new Date(o.closedAt) >= periodStart && new Date(o.closedAt) < periodEnd)
    .sort((a, b) => new Date(b.closedAt ?? 0).getTime() - new Date(a.closedAt ?? 0).getTime());
  const ganhasNoPeriodo = encerradas.filter((o) => o.status === "won");
  const perdidasNoPeriodo = encerradas.filter((o) => o.status === "lost");
  const valorGanhoPeriodo = ganhasNoPeriodo.reduce((s, o) => s + Number(o.amount), 0);
  const taxaFechamentoPeriodo =
    encerradas.length > 0 ? Math.round((ganhasNoPeriodo.length / encerradas.length) * 100) : 0;

  const mesHref = (m: string) => `/dashboard/pipeline?mes=${m}`;
  const customIniDefault = monthRange(currentMes).start.toISOString().slice(0, 10);
  const customFimDefault = new Date(monthRange(currentMes).end.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Pipeline de Oportunidades</div>
          <div className="page-sub">Ciclo de vida da venda · unidade: R$</div>
        </div>
        <Link href="/dashboard/pipeline/nova" className="btn btn-primary">
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nova oportunidade
        </Link>
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

        <div className="stat-grid">
          <div className="stat-tile green">
            <div className="stat-label">Taxa de fechamento</div>
            <div className="stat-value">{taxaFechamentoGlobal}%</div>
          </div>
          <div className="stat-tile blue">
            <div className="stat-label">Previsão ponderada</div>
            <div className="stat-value">{brl(previsaoPonderada)}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Ganhas / encerradas</div>
            <div className="stat-value">
              {wonOpps.length} / {wonOpps.length + lostOpps.length}
            </div>
          </div>
        </div>

        <PipelineBoard stages={stages} openOpportunities={openOpps} companies={companies} currentUserId={me.user.id} />

        {canManagePipeline && (
          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
              + Adicionar etapa a este pipeline
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
                  <input name="probability" type="number" min="0" max="100" required defaultValue={50} />
                </label>
                <button type="submit" className="btn btn-primary">
                  Adicionar etapa
                </button>
              </form>
            </div>
          </details>
        )}

        <div className="closed-section">
          <div className="closed-head">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            <span className="closed-title">Oportunidades encerradas</span>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              azul = fechada · vermelho = perdida
            </span>

            {!isCustom ? (
              <div className="period-filter">
                <div className="period-nav">
                  <Link href={mesHref(shiftMonth(currentMes, -1))} className="period-arrow" title="Mês anterior">
                    ←
                  </Link>
                  <span className="period-label">{monthLabel(currentMes)}</span>
                  <Link href={mesHref(shiftMonth(currentMes, 1))} className="period-arrow" title="Próximo mês">
                    →
                  </Link>
                </div>
                <Link
                  href={`/dashboard/pipeline?periodo=custom&ini=${customIniDefault}&fim=${customFimDefault}`}
                  className="period-custom-btn"
                  title="Personalizar período"
                >
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                </Link>
              </div>
            ) : (
              <div className="period-filter">
                <span className="period-label" style={{ minWidth: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
                  período personalizado
                </span>
                <Link href={mesHref(currentMonth())} className="period-custom-btn active" title="Voltar para navegação mensal">
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}>
                    <path d="M3 12h18M3 6h18M3 18h18" />
                  </svg>
                </Link>
              </div>
            )}
          </div>

          {isCustom && (
            <form method="get" className="period-range">
              <input type="hidden" name="periodo" value="custom" />
              <label>De</label>
              <input type="date" name="ini" defaultValue={ini ?? customIniDefault} />
              <label>Até</label>
              <input type="date" name="fim" defaultValue={fim ?? customFimDefault} />
              <button type="submit" className="btn btn-sm">
                Aplicar
              </button>
            </form>
          )}

          <div className="closed-summary">
            <span className="cs-stat">
              Encerradas: <b>{encerradas.length}</b>
            </span>
            <span className="cs-stat" style={{ color: "var(--blue)" }}>
              Fechadas: <b>{ganhasNoPeriodo.length}</b>
            </span>
            <span className="cs-stat" style={{ color: "var(--danger)" }}>
              Perdidas: <b>{perdidasNoPeriodo.length}</b>
            </span>
            <span className="cs-stat" style={{ color: "var(--green)" }}>
              Ganho no período: <b>{brl(valorGanhoPeriodo)}</b>
            </span>
            <span className="cs-stat">
              Taxa de fechamento: <b>{taxaFechamentoPeriodo}%</b>
            </span>
          </div>

          <div className="closed-grid">
            {encerradas.length > 0 ? (
              encerradas.map((opp: Opportunity) => {
                const won = opp.status === "won";
                return (
                  <Link key={opp.id} href={`/dashboard/pipeline/${opp.id}`} className={`closed-card ${won ? "ganho" : "perdido"}`}>
                    <div className="closed-card-top">
                      <span className="closed-co">{companyName(opp.companyId)}</span>
                      <span className={`closed-tag ${won ? "ganho" : "perdido"}`}>{won ? "Fechada" : "Perdida"}</span>
                    </div>
                    <div className="closed-prod">{fmtDate(opp.closedAt)}</div>
                    <div className="closed-foot">
                      <span className={`closed-val ${won ? "ganho" : "perdido"}`}>{brl(Number(opp.amount), opp.currency)}</span>
                      {!won && opp.lostReason && <span className="closed-motivo">{opp.lostReason}</span>}
                    </div>
                  </Link>
                );
              })
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Nenhuma oportunidade encerrada neste período.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
