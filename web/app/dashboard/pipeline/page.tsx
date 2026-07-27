import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listPipelines } from "@/lib/api/pipelines";
import {
  createOpportunityAction,
  createPipelineAction,
  createStageAction,
  markLostAction,
  markWonAction,
  moveStageAction,
  reopenAction,
} from "./actions";

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  won: "Ganho",
  lost: "Perdido",
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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
  const companyName = (id: string) =>
    companies.find((c) => c.id === id)?.name ?? "—";
  const opportunitiesByStage = (stageId: string) =>
    opportunities.filter(
      (o) => o.pipelineId === pipeline.id && o.stageId === stageId && !o.deletedAt,
    );

  return (
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Pipeline — {pipeline.name}</h2>
          <p className="sub">
            {opportunities.filter((o) => o.pipelineId === pipeline.id && !o.deletedAt).length}{" "}
            oportunidade(s)
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-panel">
        <form action={createOpportunityAction} className="form-grid">
          <input type="hidden" name="pipelineId" value={pipeline.id} />
          <label>
            Empresa*
            <select name="companyId" required defaultValue="">
              <option value="" disabled>
                selecione
              </option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
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
                <input name="name" required />
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

      <div className="kanban">
        {stages.map((stage) => {
          const stageOpportunities = opportunitiesByStage(stage.id);
          return (
            <div key={stage.id} className="kanban-column">
              <div className="kanban-column-head">
                <span>{stage.name}</span>
                <span className="count">{stageOpportunities.length}</span>
              </div>
              {stageOpportunities.map((opp) => (
                <div key={opp.id} className="kanban-card">
                  <div className="company">{companyName(opp.companyId)}</div>
                  <div className="amount">
                    {opp.currency} {Number(opp.amount).toLocaleString("pt-BR")}
                  </div>
                  <span
                    className={
                      opp.status === "won"
                        ? "badge badge-accent"
                        : opp.status === "lost"
                          ? "badge badge-danger"
                          : "badge"
                    }
                  >
                    {STATUS_LABEL[opp.status]}
                  </span>

                  {opp.status === "open" ? (
                    <>
                      <form action={moveStageAction} className="row-form">
                        <input type="hidden" name="id" value={opp.id} />
                        <input type="hidden" name="version" value={opp.version} />
                        <select name="stageId" defaultValue={opp.stageId}>
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn btn-sm">
                          Mover
                        </button>
                      </form>
                      <form action={markWonAction}>
                        <input type="hidden" name="id" value={opp.id} />
                        <input type="hidden" name="version" value={opp.version} />
                        <button type="submit" className="btn btn-sm btn-primary">
                          Ganhar
                        </button>
                      </form>
                      <form action={markLostAction} className="row-form">
                        <input type="hidden" name="id" value={opp.id} />
                        <input type="hidden" name="version" value={opp.version} />
                        <input name="lostReason" placeholder="Motivo" />
                        <button type="submit" className="btn btn-sm btn-danger">
                          Perder
                        </button>
                      </form>
                    </>
                  ) : (
                    <form action={reopenAction}>
                      <input type="hidden" name="id" value={opp.id} />
                      <input type="hidden" name="version" value={opp.version} />
                      <button type="submit" className="btn btn-sm">
                        Reabrir
                      </button>
                    </form>
                  )}
                </div>
              ))}
              {stageOpportunities.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Vazio</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
