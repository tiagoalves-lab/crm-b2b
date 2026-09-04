"use client";

import { useEffect, useState } from "react";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { CONTACT_REQUIRED_ACTIVITY_SUBTIPOS } from "@/lib/api/activities";
import type { Contact } from "@/lib/api/types";
import { createContactInlineAction } from "../../tarefas/actions";
import { createNoteRpcAction } from "../actions";

// Formulário "Registrar" da aba Timeline — compartilhado entre a ficha de
// Empresas (empresas/_ficha/ficha-body.tsx, 6 opções, com "Pós-venda") e a
// de Prospecção (leads/_ficha/ficha-body.tsx, 5 opções, sem "Pós-venda" —
// a lista de opções vira prop `subtipoOptions`), mesmo padrão de import
// cruzado já usado no projeto (tarefas/ já importa de pipeline/, aqui é o
// caminho oposto).
//
// Virou RPC (client component chamando createNoteRpcAction direto, sem
// <form action=...>) por pedido direto do usuário (2026-08-05): o
// <form action={createNoteAction}> antigo, com redirectWithMessage no
// final, fechava e reabria o drawer/modal da ficha a cada "Registrar"
// (mesmo gotcha documentado: só router.back() colapsa o slot @modal/
// @drawer interceptado, redirect() não fecha mas ainda pisca a UI num
// ciclo de navegação). Sem redirect: só router.refresh() no sucesso,
// que atualiza a Timeline com o registro novo sem navegar — o drawer
// nunca fecha.
//
// Também assumiu o combobox de Contato (antes era um componente à parte,
// NoteTypeFields) — precisou virar client component de qualquer forma
// pra poder exibir o campo condicionalmente quando o tipo escolhido exige
// (ligação/reunião/visita/e-mail, mesma regra de TipoContatoFields nas
// Tarefas), então juntar tudo num só evita duas camadas de state pra
// sincronizar.
export default function AddNoteForm({
  companyId,
  subtipoOptions,
  contacts,
  placeholder,
}: {
  companyId: string;
  subtipoOptions: Array<{ value: string; label: string }>;
  contacts: Contact[];
  placeholder: string;
}) {
  const refresh = useRefresh();
  const [subtipo, setSubtipo] = useState(subtipoOptions[0]?.value ?? "nota");
  const [texto, setTexto] = useState("");
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [decisor, setDecisor] = useState(false);

  useEffect(() => {
    setLocalContacts(contacts);
  }, [contacts]);

  const requiresContact = CONTACT_REQUIRED_ACTIVITY_SUBTIPOS.includes(subtipo);

  async function handleCreateContact() {
    const trimmedNome = nome.trim();
    if (!trimmedNome) {
      setFormError("Informe o nome do contato.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const res = await createContactInlineAction(companyId, {
      nome: trimmedNome,
      cargo: cargo.trim() || undefined,
      email: email.trim() || undefined,
      telefone: telefone.trim() || undefined,
      decisor,
    });
    setSaving(false);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setLocalContacts((prev) => [...prev, res.data]);
    setSelectedContactId(res.data.id);
    setCreating(false);
    setNome("");
    setCargo("");
    setEmail("");
    setTelefone("");
    setDecisor(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedTexto = texto.trim();
    if (!trimmedTexto) {
      setFormError("Escreva algo antes de registrar.");
      return;
    }
    if (requiresContact && !selectedContactId) {
      setFormError("Selecione um contato.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await createNoteRpcAction(companyId, {
      subtipo,
      texto: trimmedTexto,
      contactId: selectedContactId || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setTexto("");
    setSelectedContactId("");
    refresh();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <div className="add-note-types">
        {subtipoOptions.map(({ value, label }, i) => (
          <label key={value} className="note-type-btn" style={{ cursor: "pointer" }}>
            <input
              type="radio"
              name="subtipo"
              value={value}
              defaultChecked={i === 0}
              style={{ display: "none" }}
              onChange={() => setSubtipo(value)}
            />
            {label}
          </label>
        ))}
      </div>
      {requiresContact && (
        <div style={{ marginTop: 10 }}>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Contato</label>
          </div>
          <select
            value={selectedContactId}
            onChange={(event) => setSelectedContactId(event.target.value)}
            required
          >
            <option value="" disabled>
              Selecione um contato
            </option>
            {localContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.cargo ? ` — ${c.cargo}` : ""}
              </option>
            ))}
          </select>
          {localContacts.length === 0 && !creating && (
            <div className="field-hint">
              Nenhum contato cadastrado para esta empresa.{" "}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: 0 }}
                onClick={() => setCreating(true)}
              >
                + Cadastrar contato
              </button>
            </div>
          )}
          {creating && (
            <div className="field" style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <input placeholder="Nome*" value={nome} onChange={(event) => setNome(event.target.value)} />
              <input placeholder="Cargo" value={cargo} onChange={(event) => setCargo(event.target.value)} />
              <input
                placeholder="E-mail"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <input
                placeholder="Telefone"
                value={telefone}
                onChange={(event) => setTelefone(event.target.value)}
              />
              <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={decisor}
                  onChange={(event) => setDecisor(event.target.checked)}
                  style={{ width: "auto" }}
                />
                Tomador de decisão
              </label>
              <div className="row-form">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleCreateContact()}
                  disabled={saving}
                >
                  {saving ? "Salvando…" : "Salvar contato"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <textarea value={texto} onChange={(event) => setTexto(event.target.value)} placeholder={placeholder} />
      {formError && <div className="error-banner">{formError}</div>}
      <div className="add-note-foot">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Registrando…" : "Registrar"}
        </button>
      </div>
    </form>
  );
}
