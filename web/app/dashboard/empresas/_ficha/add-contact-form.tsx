"use client";

import { useState } from "react";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { createContactRpcAction } from "../actions";

// Formulário "Novo contato" da aba Contatos — compartilhado entre a ficha
// de Empresas e a de Prospecção (leads/_ficha/ficha-body.tsx), igual ao
// AddNoteForm da Timeline.
//
// Client component porque chama a Server Action como RPC em vez de usar
// `<form action={...}>`: a versão antiga terminava em redirect, o que
// recarregava a ficha inteira e piscava o drawer a cada contato inserido.
// Aqui o único efeito é router.refresh() — a lista de contatos logo abaixo
// ganha o registro novo e o drawer nem pisca.
//
// O `busy` cobre o clique duplo (era como o contato duplicado nascia:
// a ação demorava, o usuário clicava de novo). Note que aqui NÃO dá pra
// usar o SubmitButton/useFormStatus: `useFormStatus` só enxerga envio de
// Server Action feito pelo próprio <form>, e este form é controlado por
// onSubmit. Por isso o estado é manual.
export default function AddContactForm({ companyId }: { companyId: string }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [decisor, setDecisor] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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

    setNome("");
    setCargo("");
    setEmail("");
    setTelefone("");
    setDecisor(false);
    refresh();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="form-grid" style={{ marginBottom: 20 }}>
      {error && <div className="error-banner">{error}</div>}
      <label>
        Nome
        <input value={nome} onChange={(event) => setNome(event.target.value)} disabled={busy} required />
      </label>
      <label>
        Cargo
        <input value={cargo} onChange={(event) => setCargo(event.target.value)} disabled={busy} />
      </label>
      <label>
        E-mail
        <input
          value={email}
          type="email"
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        Telefone
        <input value={telefone} onChange={(event) => setTelefone(event.target.value)} disabled={busy} />
      </label>
      <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={decisor}
          onChange={(event) => setDecisor(event.target.checked)}
          disabled={busy}
          style={{ width: "auto" }}
        />
        Tomador de decisão
      </label>
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Adicionando…" : "Adicionar contato"}
      </button>
    </form>
  );
}
