"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LostReason } from "@/lib/api/opportunity-lost-reasons";
import { criarMotivoAction, excluirMotivoAction, renomearMotivoAction } from "./actions";

// Tabela editável dos motivos: um campo de nome por linha (Salvar aparece
// quando o texto muda), Excluir só pra motivo sem uso, e uma linha no fim
// pra cadastrar um novo.
export default function MotivosEditor({ motivos }: { motivos: LostReason[] }) {
  const router = useRouter();
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function executar(chave: string, fn: () => Promise<{ ok: true } | { ok: false; message: string }>, textoOk: string, depois?: () => void) {
    if (ocupado) return;
    setOcupado(chave);
    setErro(null);
    setAviso(null);
    const res = await fn();
    setOcupado(null);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    depois?.();
    setAviso(textoOk);
    router.refresh();
  }

  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      {erro && <div className="error-banner">{erro}</div>}
      {aviso && <div className="info-banner">{aviso}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Motivo</th>
            <th style={{ width: 150, textAlign: "center" }}>Oportunidades</th>
            <th style={{ width: 190 }}></th>
          </tr>
        </thead>
        <tbody>
          {motivos.map((m) => {
            const valor = nomes[m.id] ?? m.nome;
            const mudou = valor.trim() !== m.nome && valor.trim() !== "";
            const usos = m.usos ?? 0;
            return (
              <tr key={m.id}>
                <td>
                  <input
                    type="text"
                    value={valor}
                    maxLength={120}
                    style={{ width: "100%" }}
                    disabled={ocupado !== null}
                    onChange={(e) => setNomes((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && mudou) {
                        e.preventDefault();
                        void executar(m.id, () => renomearMotivoAction(m.id, valor), "Motivo renomeado.");
                      }
                    }}
                  />
                </td>
                <td style={{ textAlign: "center" }} className="t-sub">
                  {usos}
                </td>
                <td>
                  <div className="cell-actions" style={{ justifyContent: "flex-end", gap: 6 }}>
                    {mudou && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={ocupado !== null}
                          onClick={() => void executar(m.id, () => renomearMotivoAction(m.id, valor), "Motivo renomeado.")}
                        >
                          {ocupado === m.id ? "Salvando…" : "Salvar"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={ocupado !== null}
                          onClick={() =>
                            setNomes((prev) => {
                              const next = { ...prev };
                              delete next[m.id];
                              return next;
                            })
                          }
                        >
                          Desfazer
                        </button>
                      </>
                    )}
                    {!mudou && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={ocupado !== null || usos > 0}
                        title={usos > 0 ? "Motivo já usado em oportunidades — pode ser renomeado, não excluído" : "Excluir motivo"}
                        onClick={() => {
                          if (!window.confirm(`Excluir o motivo "${m.nome}"?`)) return;
                          void executar(m.id, () => excluirMotivoAction(m.id), "Motivo excluído.");
                        }}
                      >
                        {ocupado === m.id ? "Excluindo…" : "Excluir"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          <tr>
            <td>
              <input
                type="text"
                value={novo}
                maxLength={120}
                placeholder="Novo motivo"
                style={{ width: "100%" }}
                disabled={ocupado !== null}
                onChange={(e) => setNovo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && novo.trim()) {
                    e.preventDefault();
                    void executar("novo", () => criarMotivoAction(novo), "Motivo cadastrado.", () => setNovo(""));
                  }
                }}
              />
            </td>
            <td></td>
            <td>
              <div className="cell-actions" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={ocupado !== null || !novo.trim()}
                  onClick={() => void executar("novo", () => criarMotivoAction(novo), "Motivo cadastrado.", () => setNovo(""))}
                >
                  {ocupado === "novo" ? "Salvando…" : "+ Adicionar"}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="field-hint" style={{ padding: "10px 14px" }}>
        Renomear um motivo atualiza também as oportunidades que já foram perdidas com ele. Motivo já usado em alguma
        oportunidade pode ser renomeado, mas não excluído.
      </p>
    </div>
  );
}
