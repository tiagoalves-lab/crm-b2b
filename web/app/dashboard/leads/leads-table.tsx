"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Contact, RawLead } from "@/lib/api/types";
import {
  faixaDoFunil,
  FAIXA_FUNIL_LABEL,
  FAIXA_FUNIL_PILL,
  TIER_LABEL,
  type ScoreTier,
} from "@/lib/api/raw-leads";
import { approveOneLeadAction, bulkApproveLeadsAction, bulkDiscardLeadsAction, discardOneLeadAction, setLeadTierAction } from "./actions";
import BulkEditModal from "./bulk-edit-modal";
import LeadSegmentoEditor from "./lead-segmento-editor";
import LeadTagsEditor from "./lead-tags-editor";
import SubmitButton from "@/app/_components/submit-button";
import { formatDateBR } from "@/lib/format-date";
import { normalizeForFilter, useTopbarQuery } from "@/app/_components/topbar-filter";
import { leadBateComBusca } from "./filtro";

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
  nomePorUserId = {},
}: {
  rows: RawLead[];
  readOnly?: boolean;
  contactsByCompanyId?: Record<string, Contact[]>;
  // Nome do representante por id de usuário (2026-09-18) — o lead guarda
  // só o id do dono; o nome vem do Supabase Auth, via GET /memberships.
  nomePorUserId?: Record<string, string>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tierBusy, setTierBusy] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  // Filtro do cabeçalho (TopbarFilter em modo contexto, 2026-09-03): a
  // tabela filtra no estado, não por DOM, porque tem seleção em lote —
  // uma linha marcada e escondida entraria em Aprovar/Descartar/Editar em
  // lote sem o usuário ver. Por isso a seleção é zerada a cada mudança do
  // texto e toda ação em lote parte de visibleRows.
  const query = useTopbarQuery();
  const visibleRows = useMemo(() => {
    const needle = normalizeForFilter(query.trim());
    if (!needle) return rows;
    return rows.filter((lead) => leadBateComBusca(lead, needle, contactsByCompanyId));
  }, [rows, query, contactsByCompanyId]);
  // Paginação no navegador (2026-09-18, depois de o usuário dizer que
  // "voltar para os prospects trava"): a aba Prospects tem ~880 leads, e
  // cada linha desenha editor de tags, editor de segmento, seletor de
  // classificação e a lista de contatos — desenhar tudo de uma vez é o que
  // travava. Mostra um pedaço e cresce no clique. Ações em lote continuam
  // valendo só pro que está na tela (mesma regra do filtro de texto: nunca
  // aprovar/descartar linha que a pessoa não está vendo).
  const PASSO = 100;
  const [limite, setLimite] = useState(PASSO);
  useEffect(() => {
    setLimite(PASSO);
  }, [rows, query]);
  const rowsNaPagina = useMemo(() => visibleRows.slice(0, limite), [visibleRows, limite]);

  useEffect(() => {
    setSelected(new Set());
  }, [query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(rowsNaPagina.map((r) => r.id)) : new Set());
  }

  // Classificação — "" deixa o lead sem classificação (ver
  // setLeadTierAction/RawLeadService#setManualTier).
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
            Converter leads
          </button>
        </div>
      )}

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              {!readOnly && (
                <th className="checkcol">
                  <input type="checkbox" checked={rowsNaPagina.length > 0 && selected.size === rowsNaPagina.length} onChange={(e) => selectAll(e.target.checked)} />
                </th>
              )}
              {/* Coluna Funil (pedido do usuário, 2026-09-21: "quando eu
                  filtro não sei onde o lead está") — mesma régua da Busca
                  geral e das abas, em lib/api/raw-leads.ts. Fica ao lado
                  do nome porque é a primeira pergunta depois de "quem é". */}
              <th>Funil</th>
              <th>Empresa</th>
              <th>Contatos</th>
              <th>CNAE</th>
              <th>Porte</th>
              <th>Segmento</th>
              <th>Tags</th>
              <th>Representante</th>
              <th>Classificação</th>
              <th>Último contato</th>
              <th style={{ textAlign: "right" }}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rowsNaPagina.map((lead) => (
              <tr key={lead.id} className={selected.has(lead.id) ? "triage-row picked" : "triage-row"}>
                {!readOnly && (
                  <td className="checkcol">
                    <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} />
                  </td>
                )}
                <td>
                  <span className={FAIXA_FUNIL_PILL[faixaDoFunil(lead)]}>
                    {FAIXA_FUNIL_LABEL[faixaDoFunil(lead)]}
                  </span>
                </td>
                <td className="row-clickable">
                  <Link href={`/dashboard/leads/${lead.id}`} className="t-co">
                    {lead.razaoSocial}
                  </Link>
                  {/* Recuperação judicial virou bandeira ao lado do nome
                      (pedido do usuário, 2026-09-18): era uma coluna
                      inteira que, na prática, mostrava "—" em quase toda
                      linha. */}
                  {lead.emRecuperacaoJudicial && (
                    <span
                      title="Em recuperação judicial — indicativo da Receita Federal, removido da razão social"
                      style={{ color: "var(--danger)", marginLeft: 6, cursor: "help" }}
                      aria-label="Em recuperação judicial"
                    >
                      ⚑
                    </span>
                  )}
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
                <td className="t-sub" style={{ whiteSpace: "nowrap" }}>
                  {lead.ownerUserId ? (nomePorUserId[lead.ownerUserId] ?? "—") : "sem dono"}
                </td>
                <td>
                  <select
                    value={lead.manualTier ?? ""}
                    disabled={tierBusy.has(lead.id)}
                    onChange={(e) => void handleTierChange(lead.id, e.target.value)}
                    title="Classificação do lead"
                  >
                    <option value="">Sem classificação</option>
                    <option value="quente">{TIER_LABEL.quente}</option>
                    <option value="morno">{TIER_LABEL.morno}</option>
                    <option value="frio">{TIER_LABEL.frio}</option>
                  </select>
                </td>
                <td className="t-sub">{lead.ultimoContato ? formatDateBR(lead.ultimoContato) : "—"}</td>
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
                          <SubmitButton className="icon-btn" title="Converter lead">
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
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 10 : 11} className="empty">
                  {rows.length === 0 ? "Nenhum lead nesta faixa 🎯" : "Nenhum lead bate com o filtro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {visibleRows.length > rowsNaPagina.length && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "12px 16px",
              borderTop: "1px solid var(--border)",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            <span>
              Mostrando {rowsNaPagina.length} de {visibleRows.length}
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLimite((n) => n + PASSO)}>
              Mostrar mais {Math.min(PASSO, visibleRows.length - rowsNaPagina.length)}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLimite(visibleRows.length)}>
              Mostrar todos
            </button>
          </div>
        )}
      </div>

      {showBulkEdit && (
        <BulkEditModal
          leads={rowsNaPagina.filter((r) => selected.has(r.id))}
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
