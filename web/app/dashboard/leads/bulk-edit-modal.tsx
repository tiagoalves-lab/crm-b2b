"use client";

import { useState } from "react";
import type { RawLead } from "@/lib/api/types";
import { TIER_LABEL, type ScoreTier } from "@/lib/api/raw-leads";
import { setLeadSegmentoAction, setLeadTagsAction, setLeadTierAction } from "./actions";

// "" = não alterar (padrão); "auto" = limpa a classificação manual e volta
// pro score calculado (mesmo "Automático" do <select> de cada linha da
// tabela); os 3 valores de ScoreTier aplicam a classificação manual.
type TierChoice = "" | "auto" | ScoreTier;

interface FailedItem {
  razaoSocial: string;
  reason: string;
}

// "Editar em lote" (pedido direto do usuário, 2026-08-05) — botão novo na
// barra de seleção da Prospecção, entre "Limpar" e "Descartar". Decisão
// travada via pergunta direta: valor único aplicado a TODOS os
// selecionados (clássico bulk edit — um campo Segmento, um campo Tag),
// não uma lista item-a-item (esses editores já existem na própria tabela,
// ver LeadSegmentoEditor/LeadTagsEditor).
//
// Zero endpoint novo no backend: reusa setLeadSegmentoAction/
// setLeadTagsAction/setLeadTierAction (as mesmas actions das colunas da
// tabela) em loop, um PATCH por lead — não existe rota de
// "bulk-tags"/"bulk-segmento"/"bulk-tier". Segmento SUBSTITUI o valor de
// cada lead (mesmo contrato do PATCH individual); tag é SOMADA à lista
// que cada lead já tinha (não substitui as outras tags do lead) —
// comportamento diferente de propósito, porque "segmento" é valor único e
// "tag" é uma lista. Classificação (pedido do usuário, mesma sessão)
// SUBSTITUI a classificação manual de cada lead, mesmo contrato do
// <select> "Classificação manual" de cada linha da tabela.
export default function BulkEditModal({
  leads,
  onClose,
  onDone,
}: {
  leads: RawLead[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [segmento, setSegmento] = useState("");
  const [tag, setTag] = useState("");
  const [tier, setTier] = useState<TierChoice>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: number; failed: FailedItem[] } | null>(null);

  const segmentoValue = segmento.trim();
  const tagValue = tag.trim();
  const hasTier = tier !== "";

  async function handleSubmit() {
    if (!segmentoValue && !tagValue && !hasTier) {
      setError("Preencha o segmento, a tag e/ou a classificação pra aplicar aos selecionados.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    let ok = 0;
    const failed: FailedItem[] = [];

    for (const lead of leads) {
      try {
        if (segmentoValue) {
          const res = await setLeadSegmentoAction(lead.id, segmentoValue);
          if (!res.ok) throw new Error(res.message);
        }
        if (tagValue) {
          const already = lead.tags.some((t) => t.toLowerCase() === tagValue.toLowerCase());
          if (!already) {
            const res = await setLeadTagsAction(lead.id, [...lead.tags, tagValue]);
            if (!res.ok) throw new Error(res.message);
          }
        }
        if (hasTier) {
          const res = await setLeadTierAction(lead.id, tier === "auto" ? null : tier);
          if (!res.ok) throw new Error(res.message);
        }
        ok++;
      } catch (e) {
        failed.push({
          razaoSocial: lead.razaoSocial,
          reason: e instanceof Error ? e.message : "Erro desconhecido.",
        });
      }
    }

    setBusy(false);
    setResult({ ok, failed });
    if (failed.length === 0) {
      onDone();
    }
  }

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            Editar em lote ({leads.length} selecionado{leads.length === 1 ? "" : "s"})
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="t-sub" style={{ marginBottom: 12 }}>
            Campo vazio (ou &quot;Não alterar&quot;) não altera nada. Segmento e Classificação substituem o
            valor atual de cada lead selecionado; a tag é somada às que cada um já tem (não apaga
            as outras).
          </div>
          <div className="form-grid">
            <label>
              Segmento
              <input
                value={segmento}
                onChange={(e) => setSegmento(e.target.value)}
                placeholder="ex.: Metalúrgica"
                disabled={busy}
              />
            </label>
            <label>
              Adicionar tag
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="ex.: prioridade"
                disabled={busy}
              />
            </label>
            <label>
              Classificação (score)
              <select value={tier} onChange={(e) => setTier(e.target.value as TierChoice)} disabled={busy}>
                <option value="">Não alterar</option>
                <option value="auto">Automático (score calculado)</option>
                <option value="quente">{TIER_LABEL.quente}</option>
                <option value="morno">{TIER_LABEL.morno}</option>
                <option value="frio">{TIER_LABEL.frio}</option>
              </select>
            </label>
          </div>

          <div className="t-sub" style={{ marginTop: 16, marginBottom: 6, fontWeight: 600 }}>
            Selecionados
          </div>
          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
            {leads.map((l) => (
              <div
                key={l.id}
                style={{ padding: "6px 10px", fontSize: 13, borderBottom: "1px solid var(--border)" }}
              >
                {l.razaoSocial}
              </div>
            ))}
          </div>

          {error && (
            <div className="error-banner" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}

          {result && (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-body" style={{ padding: 12, fontSize: 13 }}>
                <b>{result.ok}</b> de <b>{leads.length}</b> atualizado(s).
                {result.failed.length > 0 && (
                  <>
                    <div style={{ marginTop: 8, color: "var(--danger)" }}>{result.failed.length} falha(s):</div>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {result.failed.map((f) => (
                        <li key={f.razaoSocial}>
                          {f.razaoSocial}: {f.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Fechar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? "Aplicando…" : "Aplicar aos selecionados"}
          </button>
        </div>
      </div>
    </div>
  );
}
