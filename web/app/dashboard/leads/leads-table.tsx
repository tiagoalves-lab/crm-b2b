"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Contact, RawLead } from "@/lib/api/types";
import { effectiveTier, scoreReasons, scoreTier, TIER_LABEL, type ScoreTier } from "@/lib/api/raw-leads";
import { approveOneLeadAction, bulkApproveLeadsAction, bulkDiscardLeadsAction, discardOneLeadAction, setLeadTierAction } from "./actions";
import BulkEditModal from "./bulk-edit-modal";
import LeadSegmentoEditor from "./lead-segmento-editor";
import LeadTagsEditor from "./lead-tags-editor";
import SubmitButton from "@/app/_components/submit-button";

const TIER_COLOR: Record<ScoreTier, string> = {
  quente: "var(--green)",
  morno: "var(--accent)",
  frio: "var(--danger)",
};

// Lista + seleção em lote da triagem (SPEC-CRM-GAMA.md §4.4) — a única
// parte client-side da tela: filtro de faixa/busca continua em querystring
// (Server Component, mesmo padrão de Empresas), só o conjunto selecionado
// pra ação em lote precisa viver em estado no navegador. `readOnly` (aba
// Descartados, 2026-08-03): esses leads já saíram do fluxo de triagem —
// aprovar/descartar de novo não se aplica (RawLeadService#mustBeNovo
// rejeita), então some a seleção em lote e as ações de linha, sobra só a
// ficha pra consulta.
export default function LeadsTable({
  rows,
  readOnly = false,
  contactsByCompanyId = {},
}: {
  rows: RawLead[];
  readOnly?: boolean;
  contactsByCompanyId?: Record<string, Contact[]>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tierBusy, setTierBusy] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);

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

  // Classificação manual — "" limpa a marcação e volta pro score
  // automático (ver setLeadTierAction/RawLeadService#setManualTier).
  async function handleTierChange(id: string, value: string) {
    const tier = value === "" ? null : (value as ScoreTier);
    setTierBusy((prev) => new Set(prev).add(id));
    const res = await setLeadTierAction(id, tier);
    setTierBusy((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
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
      {error && <div className="error-banner">{error}</div>}

      {!readOnly && (
        <div className={selected.size > 0 ? "triage-bulkbar" : "triage-bulkbar hidden"}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selecionado(s)</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())} disabled={busy}>
            Limpar
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setShowBulkEdit(true)}>
            Editar em lote
          </button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void runBulk(bulkDiscardLeadsAction)}>
            Descartar
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void runBulk(bulkApproveLeadsAction)}>
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            Aprovar para Lead
          </button>
        </div>
      )}

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              {!readOnly && (
                <th className="checkcol">
                  <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={(e) => selectAll(e.target.checked)} />
                </th>
              )}
              <th>Empresa</th>
              <th>Contatos</th>
              <th>Recuperação judicial</th>
              <th>CNAE</th>
              <th>Porte</th>
              <th>Segmento</th>
              <th>Tags</th>
              <th>Score de qualificação</th>
              <th style={{ textAlign: "right" }}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => {
              const tier = effectiveTier(lead);
              return (
                <tr key={lead.id} className={selected.has(lead.id) ? "triage-row picked" : "triage-row"}>
                  {!readOnly && (
                    <td className="checkcol">
                      <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} />
                    </td>
                  )}
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
                  <td style={{ minWidth: 160 }}>
                    {(lead.promotedCompanyId ? contactsByCompanyId[lead.promotedCompanyId] : undefined)?.length ? (
                      contactsByCompanyId[lead.promotedCompanyId!].map((contact) => (
                        <div key={contact.id} style={{ marginBottom: 4 }}>
                          <div>{contact.nome || "(sem nome)"}</div>
                          <div className="t-sub">
                            {contact.telefone ?? "sem telefone"} · {contact.email ?? "sem e-mail"}
                          </div>
                        </div>
                      ))
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {lead.emRecuperacaoJudicial ? (
                      <span className="pill pill-red" title="Indicativo da Receita Federal, removido da razão social">
                        ⚠ Em recuperação
                      </span>
                    ) : (
                      "—"
                    )}
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
                  <td style={{ minWidth: 120 }}>
                    <LeadSegmentoEditor leadId={lead.id} segmento={lead.segmento} readOnly={readOnly} />
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <LeadTagsEditor leadId={lead.id} tags={lead.tags} readOnly={readOnly} />
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
                    <select
                      value={lead.manualTier ?? ""}
                      disabled={tierBusy.has(lead.id)}
                      onChange={(e) => void handleTierChange(lead.id, e.target.value)}
                      title="Classificação manual — sobrepõe o cálculo automático por score"
                      style={{ marginTop: 6 }}
                    >
                      <option value="">Automático ({TIER_LABEL[scoreTier(lead.score)]})</option>
                      <option value="quente">{TIER_LABEL.quente}</option>
                      <option value="morno">{TIER_LABEL.morno}</option>
                      <option value="frio">{TIER_LABEL.frio}</option>
                    </select>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="cell-actions" style={{ justifyContent: "flex-end" }}>
                      <Link href={`/dashboard/leads/${lead.id}`} className="icon-btn" title="Abrir ficha (tarefas e histórico)">
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <path d="M15 3h6v6M10 14L21 3" />
                        </svg>
                      </Link>
                      {!readOnly && (
                        <>
                          <form action={approveOneLeadAction}>
                            <input type="hidden" name="id" value={lead.id} />
                            <input type="hidden" name="back" value="/dashboard/leads" />
                            <SubmitButton className="icon-btn" title="Aprovar">
                              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            </SubmitButton>
                          </form>
                          <form action={discardOneLeadAction}>
                            <input type="hidden" name="id" value={lead.id} />
                            <input type="hidden" name="back" value="/dashboard/leads" />
                            <SubmitButton className="icon-btn danger" title="Descartar">
                              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                              </svg>
                            </SubmitButton>
                          </form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 9 : 10} className="empty">
                  Nenhum lead nesta faixa 🎯
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showBulkEdit && (
        <BulkEditModal
          leads={rows.filter((r) => selected.has(r.id))}
          onClose={() => setShowBulkEdit(false)}
          onDone={() => {
            setShowBulkEdit(false);
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
