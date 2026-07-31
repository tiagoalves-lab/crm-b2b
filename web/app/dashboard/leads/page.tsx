import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listRawLeads, scoreTier, type ScoreTier } from "@/lib/api/raw-leads";
import { createRawLeadAction } from "./actions";
import LeadFicha from "./lead-ficha";
import LeadsTable from "./leads-table";

type TierFilter = "todos" | ScoreTier;
const TIER_TABS: Array<{ key: TierFilter; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "quente", label: "Quentes" },
  { key: "morno", label: "Mornos" },
  { key: "frio", label: "Frios" },
];

const PORTES = ["GRANDE", "MÉDIO", "PEQUENO"];
const SITUACOES = ["ATIVA", "BAIXADA", "SUSPENSA", "INAPTA", "NULA"];
const FONTES = [
  { value: "manual", label: "Manual" },
  { value: "econodata", label: "Econodata" },
  { value: "apify", label: "Apify" },
  { value: "comexstat", label: "Comex Stat" },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    tier?: string;
    q?: string;
    lead?: string;
    aba?: string;
  }>;
}) {
  const { error, tier, q, lead, aba } = await searchParams;
  const token = await getServerAccessToken();

  if (lead) {
    return <LeadFicha token={token} leadId={lead} aba={aba} error={error} />;
  }

  const [{ items: novos }, { total: aprovados }, { total: descartados }] = await Promise.all([
    listRawLeads(token, { status: "novo" }),
    listRawLeads(token, { status: "aprovado", pageSize: 1 }),
    listRawLeads(token, { status: "descartado", pageSize: 1 }),
  ]);

  const quenteCount = novos.filter((r) => scoreTier(r.score) === "quente").length;
  const mornoCount = novos.filter((r) => scoreTier(r.score) === "morno").length;
  const frioCount = novos.filter((r) => scoreTier(r.score) === "frio").length;

  const currentTier: TierFilter =
    tier === "quente" || tier === "morno" || tier === "frio" ? tier : "todos";
  const search = (q ?? "").trim().toLowerCase();

  const rows = novos
    .filter((r) => currentTier === "todos" || scoreTier(r.score) === currentTier)
    .filter(
      (r) =>
        !search ||
        r.razaoSocial.toLowerCase().includes(search) ||
        (r.cnaePrincipal ?? "").toLowerCase().includes(search) ||
        (r.cnaeDescricao ?? "").toLowerCase().includes(search),
    )
    .sort((a, b) => b.score - a.score);

  const tabHref = (t: TierFilter) =>
    `/dashboard/leads?tier=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const leadHref = (id: string) => `/dashboard/leads?lead=${id}`;

  return (
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Leads</h2>
          <p className="sub">Caixa de entrada do crawler · scoring, tarefas e histórico</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Na fila de triagem</div>
          <div className="stat-value">{novos.length}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Quentes (≥70)</div>
          <div className="stat-value">{quenteCount}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Mornos (45–69)</div>
          <div className="stat-value">{mornoCount}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Frios (&lt;45)</div>
          <div className="stat-value">{frioCount}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Aprov. / descart.</div>
          <div className="stat-value">
            {aprovados}/{descartados}
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <div className="view-tabs">
          {TIER_TABS.map((t) => (
            <Link key={t.key} href={tabHref(t.key)} className={currentTier === t.key ? "view-tab active" : "view-tab"}>
              {t.label}
            </Link>
          ))}
        </div>
        <form method="get" className="row-form">
          {currentTier !== "todos" && <input type="hidden" name="tier" value={currentTier} />}
          <input name="q" defaultValue={q ?? ""} placeholder="Buscar razão social ou CNAE..." />
          <button type="submit" className="btn btn-sm">
            Buscar
          </button>
        </form>
      </div>

      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
          + Importar lead manualmente
        </summary>
        <div className="form-panel" style={{ marginTop: 8 }}>
          <form action={createRawLeadAction} className="form-grid">
            <label>
              Razão social*
              <input name="razaoSocial" required maxLength={255} />
            </label>
            <label>
              CNPJ
              <input name="cnpj" maxLength={20} />
            </label>
            <label>
              CNAE principal
              <input name="cnaePrincipal" placeholder="2511-0" maxLength={10} />
            </label>
            <label>
              Descrição do CNAE
              <input name="cnaeDescricao" maxLength={255} />
            </label>
            <label>
              Porte
              <select name="porte" defaultValue="">
                <option value="">—</option>
                {PORTES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Situação cadastral
              <select name="situacao" defaultValue="ATIVA">
                {SITUACOES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              UF
              <input name="uf" maxLength={2} placeholder="RS" />
            </label>
            <label>
              Município
              <input name="municipio" maxLength={255} />
            </label>
            <label>
              Origem
              <select name="fonte" defaultValue="manual">
                {FONTES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="row-form" style={{ alignItems: "center" }}>
              <input type="checkbox" name="importador" style={{ width: "auto" }} />
              Importador (Comex Stat)
            </label>
            <button type="submit" className="btn btn-primary">
              Adicionar à triagem
            </button>
          </form>
        </div>
      </details>

      <LeadsTable rows={rows} leadHref={leadHref} />
    </div>
  );
}
