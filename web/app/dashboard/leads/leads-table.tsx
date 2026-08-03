"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RawLead } from "@/lib/api/types";
import { scoreReasons, scoreTier, type ScoreTier } from "@/lib/api/raw-leads";
import { approveOneLeadAction, bulkApproveLeadsAction, bulkDiscardLeadsAction, discardOneLeadAction } from "./actions";

const TIER_COLOR: Record<ScoreTier, string> = {
  quente: "var(--green)",
  morno: "var(--accent)",
  frio: "var(--danger)",
};

// Lista + seleção em lote da triagem (SPEC-CRM-GAMA.md §4.4) — a única
// parte client-side da tela: filtro de faixa/busca continua em querystring
// (Server Component, mesmo padrão de Empresas), só o conjunto selecionado
// pra ação em lote precisa viver em estado no navegador.
export default function LeadsTable({ rows }: { rows: RawLead[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function selectQuentes() {
    setSelected(new Set(rows.filter((r) => scoreTier(r.score) === "quente").map((r) => r.id)));
  }

  async function runBulk(action: typeof bulkApproveLeadsAction) {
    setBusy(true);
    setError(null);
    const res = await action([...selected]);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <button type="button" className="btn btn-sm" onClick={selectQuentes} disabled={busy}>
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          Selecionar quentes
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className={selected.size > 0 ? "triage-bulkbar" : "triage-bulkbar hidden"}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selecionado(s)</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())} disabled={busy}>
          Limpar
        </button>
        <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void runBulk(bulkDiscardLeadsAction)}>
          Descartar
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void runBulk(bulkApproveLeadsAction)}>
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          Aprovar p/ prospecção
        </button>
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th className="checkcol">
                <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={(e) => selectAll(e.target.checked)} />
              </th>
              <th>Empresa</th>
              <th>CNAE</th>
              <th>Porte</th>
              <th>Origem</th>
              <th>Score de qualificação</th>
              <th style={{ textAlign: "right" }}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => {
              const tier = scoreTier(lead.score);
              return (
                <tr key={lead.id} className={selected.has(lead.id) ? "triage-row picked" : "triage-row"}>
                  <td className="checkcol">
                    <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} />
                  </td>
                  <td className="row-clickable">
                    <Link href={`/dashboard/leads/${lead.id}`} className="t-co">
                      {lead.razaoSocial}
                    </Link>
                    <div className="t-sub">
                      {lead.cnpj ?? "sem CNPJ"} · {lead.municipio ?? "—"}
                      {lead.uf ? `/${lead.uf}` : ""}
                      {lead.situacao && lead.situacao !== "ATIVA" && <span style={{ color: "var(--danger)" }}> · {lead.situacao}</span>}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{lead.cnaePrincipal ?? "—"}</div>
                    <div className="t-sub" style={{ maxWidth: 150, whiteSpace: "normal" }}>
                      {lead.cnaeDescricao ?? ""}
                    </div>
                  </td>
                  <td>
                    <span className="pill pill-gray">{lead.porte ?? "—"}</span>
                  </td>
                  <td>
                    <span className="task-type">{lead.fonte}</span>
                    {lead.importador && <div className="t-sub" style={{ color: "var(--green)", marginTop: 3 }}>↧ importa</div>}
                  </td>
                  <td>
                    <div className="score-cell">
                      <span className={`tier-tag tier-${tier}`}>{lead.score}</span>
                      <div className="score-mini">
                        <div className="score-mini-fill" style={{ width: `${lead.score}%`, background: TIER_COLOR[tier] }} />
                      </div>
                      <span className="score-why" title={scoreReasons(lead).join(" · ")}>
                        ⓘ
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="cell-actions" style={{ justifyContent: "flex-end" }}>
                      <Link href={`/dashboard/leads/${lead.id}`} className="icon-btn" title="Abrir ficha (tarefas e histórico)">
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <path d="M15 3h6v6M10 14L21 3" />
                        </svg>
                      </Link>
                      <form action={approveOneLeadAction}>
                        <input type="hidden" name="id" value={lead.id} />
                        <input type="hidden" name="back" value="/dashboard/leads" />
                        <button type="submit" className="icon-btn" title="Aprovar">
                          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </button>
                      </form>
                      <form action={discardOneLeadAction}>
                        <input type="hidden" name="id" value={lead.id} />
                        <input type="hidden" name="back" value="/dashboard/leads" />
                        <button type="submit" className="icon-btn danger" title="Descartar">
                          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  Nenhum lead nesta faixa 🎯
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
