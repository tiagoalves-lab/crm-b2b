"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dayKeyBR } from "@/lib/format-date";

// "Colocar em Stand by" (pedido do usuário, 2026-10-22): o cliente avaliou
// e vai retomar mais adiante. A nova previsão de fechamento é obrigatória —
// é o dia em que a oportunidade volta a aparecer no calendário de Tarefas.
// Mesmo molde do modal de motivo de perda (motivo-perda-modal.tsx): portal
// no body, por cima do card, e Esc fecha só este modal.
export default function StandbyModal({
  previsaoAtual,
  enviando,
  onConfirmar,
  onCancelar,
}: {
  previsaoAtual: string | null;
  enviando: boolean;
  onConfirmar: (dayKey: string) => void;
  onCancelar: () => void;
}) {
  const hoje = dayKeyBR(new Date());
  // Começa vazio de propósito: a data é NOVA, quem coloca em stand by
  // precisa escolher — não confirmar a previsão antiga sem olhar.
  const [data, setData] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancelar();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancelar]);

  const valida = /^\d{4}-\d{2}-\d{2}$/.test(data) && data >= hoje;

  return createPortal(
    <div className="overlay open" style={{ zIndex: 120 }} onClick={() => !enviando && onCancelar()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Colocar em Stand by</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelar} disabled={enviando} aria-label="Cancelar">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valida && !enviando) onConfirmar(data);
          }}
        >
          <div className="modal-body">
            <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              O cliente avaliou e vai retomar mais adiante. A oportunidade sai do quadro e volta a aparecer no
              calendário na nova data.
            </p>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              Nova previsão de fechamento*
              <input
                ref={inputRef}
                type="date"
                required
                min={hoje}
                value={data}
                disabled={enviando}
                onChange={(e) => setData(e.target.value)}
              />
            </label>
            {previsaoAtual && (
              <p className="field-hint" style={{ marginTop: 6 }}>
                Previsão atual: {previsaoAtual}
              </p>
            )}
            {data !== "" && data < hoje && (
              <p className="field-hint" style={{ marginTop: 6, color: "var(--danger)" }}>
                Escolha uma data de hoje em diante.
              </p>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={!valida || enviando}>
              {enviando ? "Salvando…" : "Colocar em Stand by"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
