"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LostReason } from "@/lib/api/opportunity-lost-reasons";
import { createLostReasonAction, listLostReasonsAction } from "../actions";

// "Por que a negociação foi perdida?" (pedido do usuário, 2026-09-17) —
// mesmo formato do modal de SLA do quadro (pipeline-board.tsx, "Por que a
// proposta voltou?"), que o usuário pediu pra repetir: um botão grande por
// opção, clicar já confirma. A diferença é a lista vir do banco e ter
// "+ Novo motivo" pra cadastrar o que não estiver nela — motivo digitado
// solto a cada vez quebraria o Pareto em grafias diferentes.
//
// Portal no body porque abre por cima do card, que já é um modal: dentro
// dele o overlay herdaria o posicionamento do card. O Esc é tratado em
// fase de captura pra fechar só este modal, não o card junto.
export default function MotivoPerdaModal({
  onEscolher,
  onCancelar,
  enviando,
}: {
  onEscolher: (motivo: string) => void;
  onCancelar: () => void;
  enviando: boolean;
}) {
  const [motivos, setMotivos] = useState<LostReason[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listLostReasonsAction().then((res) => {
      if (res.ok) setMotivos(res.data);
      else setErro(res.message);
    });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancelar();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancelar]);

  useEffect(() => {
    if (novoAberto) inputRef.current?.focus();
  }, [novoAberto]);

  // Cadastrar o motivo novo não marca a perda sozinho: ele entra na lista
  // e o usuário clica nele, igual aos outros — confirmação num gesto só.
  async function salvarNovo() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    const res = await createLostReasonAction(novoNome);
    setSalvando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setMotivos((prev) =>
      [...(prev ?? []), res.data].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    );
    setNovoNome("");
    setNovoAberto(false);
  }

  const desabilitado = enviando || salvando;

  return createPortal(
    <div className="overlay open" style={{ zIndex: 120 }} onClick={() => !enviando && onCancelar()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Por que a negociação foi perdida?</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelar} disabled={enviando} aria-label="Cancelar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
            A oportunidade vai para <strong>Perdida</strong>. Escolha o motivo:
          </p>
          {erro && <div className="error-banner">{erro}</div>}
          {motivos === null && !erro && <p className="field-hint">Carregando motivos…</p>}
          <div style={{ display: "grid", gap: 10 }}>
            {motivos?.map((m) => (
              <button
                key={m.id}
                type="button"
                className="btn btn-ghost"
                style={{ textAlign: "left", display: "block", padding: "12px 14px", height: "auto", whiteSpace: "normal" }}
                disabled={desabilitado}
                onClick={() => onEscolher(m.nome)}
              >
                <strong>{m.nome}</strong>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            {novoAberto ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={novoNome}
                  maxLength={120}
                  placeholder="Descreva o novo motivo"
                  style={{ flex: 1 }}
                  disabled={desabilitado}
                  onChange={(e) => setNovoNome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void salvarNovo();
                    }
                  }}
                />
                <button type="button" className="btn btn-primary" disabled={desabilitado || !novoNome.trim()} onClick={() => void salvarNovo()}>
                  {salvando ? "Salvando…" : "Salvar"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={salvando}
                  onClick={() => {
                    setNovoAberto(false);
                    setNovoNome("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" disabled={desabilitado} onClick={() => setNovoAberto(true)}>
                + Novo motivo
              </button>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={enviando}>
            {enviando ? "Marcando como perdida…" : "Cancelar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
