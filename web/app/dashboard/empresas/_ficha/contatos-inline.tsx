"use client";

import { useState } from "react";
import type { Contact } from "@/lib/api/types";
import { createContactRpcAction } from "../actions";

// Contatos de uma empresa recém-cadastrada, dentro de um modal que não é
// rota (cadastro de empresa aberto de dentro do card de oportunidade —
// ver nova-ficha.tsx, variante "modal").
//
// Não é o AddContactForm da ficha porque aquele termina em `useRefresh()`:
// um refresh aqui re-resolveria a árvore de rotas com o card de
// oportunidade aberto por cima e trocaria o card pela página cheia (mesmo
// defeito de 2026-09-04 com anexo). Aqui a lista vive em estado local — o
// que foi cadastrado já está no banco, e a ficha da empresa mostra tudo
// quando for aberta.
export default function ContatosInline({ companyId }: { companyId: string }) {
  const [contatos, setContatos] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [decisor, setDecisor] = useState(false);

  async function adicionar() {
    if (busy) return;
    const trimmed = nome.trim();
    if (!trimmed) {
      setError("Informe o nome do contato.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createContactRpcAction(companyId, {
      nome: trimmed,
      cargo: cargo.trim() || undefined,
      email: email.trim() || undefined,
      telefone: telefone.trim() || undefined,
      decisor,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setContatos((prev) => [...prev, res.data]);
    setNome("");
    setCargo("");
    setEmail("");
    setTelefone("");
    setDecisor(false);
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-grid">
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} disabled={busy} />
        </label>
        <label>
          Cargo
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} disabled={busy} />
        </label>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        </label>
        <label>
          Telefone
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} disabled={busy} />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={decisor}
            onChange={(e) => setDecisor(e.target.checked)}
            disabled={busy}
            style={{ width: "auto" }}
          />
          Tomador de decisão
        </label>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void adicionar()}
          disabled={busy}
        >
          {busy ? "Adicionando…" : "Adicionar contato"}
        </button>
      </div>

      {contatos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {contatos.map((c) => (
            <div key={c.id} className="drawer-list-item">
              <div>
                <div className="dli-title">
                  {c.nome}
                  {c.decisor && (
                    <span className="pill pill-green" style={{ marginLeft: 8 }}>
                      decisor
                    </span>
                  )}
                </div>
                <div className="dli-sub">
                  {[c.cargo, c.email, c.telefone].filter(Boolean).join(" · ") || "sem dados de contato"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
