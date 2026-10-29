"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface MembroOpcao {
  userId: string;
  nome: string;
}

// Membros da tarefa na ficha (2026-09-30, pedido do usuário): a lista
// inteira de usuários em chips poluía o card — agora o card mostra só os
// escolhidos e a lista mora numa janela de seleção. A escolha vale ao
// clicar "Salvar" da ficha, como todo o resto do formulário.
//
// Janela própria via portal (não o OverlayModal de rota interceptada, que
// fecha com router.back() e derrubaria a ficha atrás) — mesmo esquema do
// aviso de aba travada em empresas/_ficha/nova-ficha.tsx. Camada acima da
// ficha (z-index 100).
export default function MembrosPicker({
  opcoes,
  selecionados,
  onChange,
  disabled,
}: {
  opcoes: MembroOpcao[];
  selecionados: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<string[]>(selecionados);
  const [busca, setBusca] = useState("");

  const escolhidos = opcoes.filter((o) => selecionados.includes(o.userId));
  const termo = busca.trim().toLowerCase();
  const visiveis = termo ? opcoes.filter((o) => o.nome.toLowerCase().includes(termo)) : opcoes;

  function abrir() {
    setRascunho(selecionados);
    setBusca("");
    setAberto(true);
  }

  function alternar(userId: string) {
    setRascunho((atual) =>
      atual.includes(userId) ? atual.filter((id) => id !== userId) : [...atual, userId],
    );
  }

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto]);

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div className="field" style={{ marginBottom: 6 }}>
        <label>Membros</label>
      </div>
      <div className="membros-row">
        {escolhidos.map((o) => (
          <span key={o.userId} className="membro-chip">
            {o.nome}
            <button
              type="button"
              className="membro-remover"
              aria-label={`Tirar ${o.nome}`}
              disabled={disabled}
              onClick={() => onChange(selecionados.filter((id) => id !== o.userId))}
            >
              ×
            </button>
          </span>
        ))}
        <button type="button" className="btn btn-sm" onClick={abrir} disabled={disabled}>
          {escolhidos.length > 0 ? "Alterar membros" : "+ Incluir membros"}
        </button>
      </div>
      {escolhidos.length === 0 && (
        <div className="field-hint">
          Membros veem a tarefa na lista deles e podem comentar, anexar e concluir.
        </div>
      )}

      {aberto &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="overlay open" style={{ zIndex: 120 }} onClick={() => setAberto(false)}>
            <div
              className="modal"
              style={{ maxWidth: 420 }}
              role="dialog"
              aria-label="Selecionar membros"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-head">
                <div className="modal-title">Selecionar membros</div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAberto(false)}
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
              <div className="modal-body">
                <input
                  type="search"
                  placeholder="Buscar pelo nome"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  autoFocus
                  style={{ width: "100%", marginBottom: 10 }}
                />
                <div className="membros-lista">
                  {visiveis.map((o) => (
                    <label key={o.userId} className="membros-item">
                      <input
                        type="checkbox"
                        checked={rascunho.includes(o.userId)}
                        onChange={() => alternar(o.userId)}
                      />
                      {o.nome}
                    </label>
                  ))}
                  {visiveis.length === 0 && <div className="field-hint">Ninguém com esse nome.</div>}
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setAberto(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onChange(rascunho);
                    setAberto(false);
                  }}
                >
                  Confirmar{rascunho.length > 0 ? ` (${rascunho.length})` : ""}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
