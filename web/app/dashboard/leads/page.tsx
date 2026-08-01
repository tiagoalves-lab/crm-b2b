import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listRawLeads, scoreTier, type ScoreTier } from "@/lib/api/raw-leads";
import { createRawLeadAction } from "./actions";
import LeadsTable from "./leads-table";
import RescoreButton from "./rescore-button";

type TierFilter = "todos" | ScoreTier;

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
  searchParams: Promise<{ error?: string; tier?: string; q?: string }>;
}) {
  const { error, tier, q } = await searchParams;
  const token = await getServerAccessToken();

  const [{ items: novos }, { total: aprovados }, { total: descartados }] = await Promise.all([
    listRawLeads(token, { status: "novo" }),
    listRawLeads(token, { status: "aprovado", pageSize: 1 }),
    listRawLeads(token, { status: "descartado", pageSize: 1 }),
  ]);

  const quenteCount = novos.filter((r) => scoreTier(r.score) === "quente").length;
  const mornoCount = novos.filter((r) => scoreTier(r.score) === "morno").length;
  const frioCount = novos.filter((r) => scoreTier(r.score) === "frio").length;

  const currentTier: TierFilter = tier === "quente" || tier === "morno" || tier === "frio" ? tier : "todos";
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

  const tabHref = (t: TierFilter) => `/dashboard/leads?tier=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Leads</div>
          <div className="page-sub">Caixa de entrada do crawler · scoring, tarefas e histórico</div>
        </div>
        <RescoreButton />
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

        <div className="panel" style={{ background: "var(--blue-soft)", borderColor: "rgba(74,159,224,.3)", marginBottom: 16 }}>
          <div className="panel-body" style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" style={{ width: 18, height: 18, flexShrink: 0 }}>
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Estes são os leads <b>brutos</b> do crawler/Apify. A máquina pontua;{" "}
              <b style={{ color: "var(--accent-secondary)" }}>você aprova os bons</b> — eles viram empresas (tipo lead)
              com ficha, tarefas e histórico. Nem todo lead vira cliente, mas o histórico fica registrado. O resto fica
              aqui, sem poluir a carteira.
            </span>
          </div>
        </div>

        <div className="funnel-stat">
          <div className="fstat">
            <div className="fstat-v">{novos.length}</div>
            <div className="fstat-l">Na fila de triagem</div>
          </div>
          <div className="fstat q">
            <div className="fstat-v" style={{ color: "var(--green)" }}>
              {quenteCount}
            </div>
            <div className="fstat-l">Quentes (≥70)</div>
          </div>
          <div className="fstat m">
            <div className="fstat-v" style={{ color: "var(--accent-secondary)" }}>
              {mornoCount}
            </div>
            <div className="fstat-l">Mornos (45–69)</div>
          </div>
          <div className="fstat f">
            <div className="fstat-v" style={{ color: "var(--danger)" }}>
              {frioCount}
            </div>
            <div className="fstat-l">Frios (&lt;45)</div>
          </div>
          <div className="fstat">
            <div className="fstat-v" style={{ color: "var(--text-secondary)" }}>
              {aprovados}/{descartados}
            </div>
            <div className="fstat-l">Aprov. / descart.</div>
          </div>
        </div>

        <div className="toolbar">
          <div className="seg">
            <Link href={tabHref("todos")} className={currentTier === "todos" ? "active" : undefined}>
              Todos
            </Link>
            <Link href={tabHref("quente")} className={currentTier === "quente" ? "active" : undefined}>
              Quentes
            </Link>
            <Link href={tabHref("morno")} className={currentTier === "morno" ? "active" : undefined}>
              Mornos
            </Link>
            <Link href={tabHref("frio")} className={currentTier === "frio" ? "active" : undefined}>
              Frios
            </Link>
          </div>
          <form method="get" className="search">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            {currentTier !== "todos" && <input type="hidden" name="tier" value={currentTier} />}
            <input name="q" defaultValue={q ?? ""} placeholder="Buscar razão social ou CNAE..." />
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

        <LeadsTable rows={rows} />
      </div>
    </>
  );
}
