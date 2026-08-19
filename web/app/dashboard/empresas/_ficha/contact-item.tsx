"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Contact } from "@/lib/api/types";
import { deleteContactRpcAction, updateContactAction } from "../actions";

// Item da aba "Contatos" (Empresas e Leads, reusa o mesmo componente).
// Client component por causa do modo de edição inline (view ⇄ form).
// Editar e Remover chamam a Server Action via onClick (RPC, sem redirect)
// pra atualizar a ficha sem sair dela — Remover era `<form action>` com
// redirect até 2026-08-13, o que recarregava a rota inteira e piscava o
// drawer a cada remoção. Editar/Remover aparecem por conta própria
// (canEdit/canRemove vêm da matriz granular de permissões, módulo
// "contatos" — ver lib/api/permission-catalog.ts — não mais um bloco
// único fixo em owner/admin como era até 2026-08-12).
export default function ContactItem({
  contact,
  companyId,
  canEdit,
  canRemove,
}: {
  contact: Contact;
  companyId: string;
  canEdit: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nome, setNome] = useState(contact.nome);
  const [cargo, setCargo] = useState(contact.cargo ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [telefone, setTelefone] = useState(contact.telefone ?? "");
  const [decisor, setDecisor] = useState(contact.decisor);

  async function handleRemove() {
    if (busy) return;
    if (!window.confirm(`Remover o contato "${contact.nome || "(sem nome)"}"?`)) return;
    setBusy(true);
    setError(null);
    const res = await deleteContactRpcAction(companyId, contact.id);
    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      return;
    }
    // Sem setBusy(false) no sucesso de propósito: o item vai sumir da
    // lista no refresh, e reabilitar o botão antes disso só daria margem
    // pra um segundo clique num contato que já não existe (404).
    router.refresh();
  }

  function cancelEdit() {
    setNome(contact.nome);
    setCargo(contact.cargo ?? "");
    setEmail(contact.email ?? "");
    setTelefone(contact.telefone ?? "");
    setDecisor(contact.decisor);
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!nome.trim()) {
      setError("Informe o nome do contato.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await updateContactAction(companyId, contact.id, {
      nome: nome.trim(),
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
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="drawer-list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-grid">
          <label>
            Nome
            <input value={nome} onChange={(event) => setNome(event.target.value)} disabled={busy} />
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
        </div>
        <div className="row-form" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={cancelEdit}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void handleSave()}>
            Salvar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="drawer-list-item">
      <div>
        {/* Erro de remoção precisa aparecer AQUI também: no modo de
            exibição o bloco de erro do formulário de edição não está
            montado, e sem isto uma falha em Remover seria silenciosa. */}
        {error && <div className="error-banner">{error}</div>}
        <div className="dli-title">
          {contact.nome || "(sem nome)"}
          {contact.cargo ? ` — ${contact.cargo}` : ""}
        </div>
        <div className="dli-sub">
          {[contact.email, contact.telefone].filter(Boolean).join(" · ") || "sem e-mail/telefone"}
        </div>
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={contact.decisor}
            onChange={() => {}}
            onClick={(event) => event.preventDefault()}
            style={{ width: "auto", accentColor: "var(--blue)" }}
          />
          <span className="dli-sub" style={{ margin: 0 }}>
            Tomador de decisão
          </span>
        </label>
      </div>
      {(canEdit || canRemove) && (
        <div style={{ display: "flex", gap: 6 }}>
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Editar
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => void handleRemove()}
            >
              {busy ? "Removendo…" : "Remover"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
