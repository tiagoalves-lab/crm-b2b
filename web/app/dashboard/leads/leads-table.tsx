"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RawLead } from "@/lib/api/types";
import { scoreTier, type ScoreTier } from "@/lib/api/raw-leads";
import {
  bulkApproveLeadsAction,
  bulkDiscardLeadsAction,
  rescoreLeadsAction,
} from "./actions";

const TIER_LABEL: Record<ScoreTier, string> = {
  quente: "Quente",
  morno: "Morno",
  frio: "Frio",
};
const TIER_BADGE: Record<ScoreTier, string> = {
  quente: "badge badge-accent",
  morno: "badge",
  frio: "badge badge-danger",
};

// Lista + seleção em lote da triagem (SPEC-CRM-GAMA.md §4.4) — a única
// parte client-side da tela: filtro de faixa/busca continua em querystring
// (Server Component, mesmo padrão de Empresas), só o conjunto selecionado
// pra ação em lote precisa viver em estado no navegador.
export default function LeadsTable({
  rows,
  leadHref,
}: {
  rows: RawLead[];
  leadHref: (id: string) => string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }

  function selectQuentes() {
    setSelected(new Set(rows.filter((r) => scoreTier(r.score) === "quente").map((r) => r.id)));
    setMessage("Leads quentes selecionados.");
  }

  async function runBulk(action: typeof bulkApproveLeadsAction, verb: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await action([...selected]);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const { ok, failed } = res.data;
    setMessage(
      `${ok.length} lead(s) ${verb}${failed.length ? ` — ${failed.length} falharam` : ""}.`,
    );
    setSelected(new Set());
    router.refresh();
  }

  async function handleRescore() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await rescoreLeadsAction();
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setMessage(`${res.data.updated} lead(s) recalculado(s).`);
    router.refresh();
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <div className="row-form">
          <button type="button" className="btn btn-sm" onClick={selectQuentes} disabled={busy}>
            Selecionar quentes
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={handleRescore} disabled={busy}>
            Recalcular scores
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && <p className="sub">{message}</p>}

      {selected.size > 0 && (
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selecionado(s)</span>
          <div className="row-form">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())} disabled={busy}>
              Limpar
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => void runBulk(bulkDiscardLeadsAction, "descartado(s)")}
            >
              Descartar
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => void runBulk(bulkApproveLeadsAction, "aprovado(s)")}
            >
              Aprovar p/ prospecção
            </button>
          </div>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={rows.length > 0 && selected.size === rows.length}
                onChange={(e) => selectAll(e.target.checked)}
              />
            </th>
            <th>Empresa</th>
            <th>CNAE</th>
            <th>Porte</th>
            <th>Origem</th>
            <th>Score</th>
            <th style={{ textAlign: "right" }}>Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => {
            const tier = scoreTier(lead.score);
            return (
              <tr key={lead.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                  />
                </td>
                <td>
                  <a href={leadHref(lead.id)}>{lead.razaoSocial}</a>
                  <div className="sub">
                    {lead.cnpj ?? "sem CNPJ"} · {lead.municipio ?? "—"}
                    {lead.uf ? `/${lead.uf}` : ""}
                    {lead.situacao && lead.situacao !== "ATIVA" && (
                      <span style={{ color: "var(--danger, #c0392b)" }}> · {lead.situacao}</span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ fontFamily: "monospace", fontSize: 12 }}>{lead.cnaePrincipal ?? "—"}</div>
                  <div className="sub">{lead.cnaeDescricao ?? ""}</div>
                </td>
                <td>{lead.porte ?? "—"}</td>
                <td>
                  {lead.fonte}
                  {lead.importador && <div className="sub">↧ importa</div>}
                </td>
                <td>
                  <span className={TIER_BADGE[tier]} title={`${TIER_LABEL[tier]} (${lead.score})`}>
                    {lead.score} · {TIER_LABEL[tier]}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <a href={leadHref(lead.id)} className="btn btn-sm btn-ghost">
                    Ficha
                  </a>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                Nenhum lead nesta faixa.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
