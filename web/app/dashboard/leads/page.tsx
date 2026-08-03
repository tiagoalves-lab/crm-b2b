import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listRawLeads, scoreTier, type ScoreTier } from "@/lib/api/raw-leads";
import ImportSpreadsheetForm from "./import-spreadsheet-form";
import LeadsTable from "./leads-table";
import RescoreButton from "./rescore-button";

type TierFilter = "todos" | ScoreTier;

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
        <div style={{ display: "flex", gap: 8 }}>
          <RescoreButton />
          <Link href="/dashboard/leads/novo" className="btn btn-primary">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Novo lead
          </Link>
        </div>
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

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
            + Importar planilha (CSV/Excel do crawler)
          </summary>
          <div className="form-panel" style={{ marginTop: 8 }}>
            <ImportSpreadsheetForm />
          </div>
        </details>

        <LeadsTable rows={rows} />
      </div>
    </>
  );
}
