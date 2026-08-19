"use client";

import { useEffect, useState } from "react";
import { CONTACT_REQUIRED_TASK_TYPES, TASK_TYPE_LABELS } from "@/lib/api/tasks";
import type { Contact, TaskType } from "@/lib/api/types";
import { createContactInlineAction } from "./actions";

// Compartilhado entre "Nova tarefa" (nova/nova-form.tsx, renderizado por
// um client component) e o form de edição dentro do modal de detalhe
// (_detail/detail-body.tsx, renderizado por um Server Component — dá pra
// importar um client component dentro de um Server Component normalmente,
// só não o contrário). Auto-contido (estado do Tipo/Contato é interno)
// pra funcionar nos dois: pedido do usuário (2026-08-04), Contato da
// empresa fica obrigatório quando o Tipo é Ligação/Reunião/Visita/
// E-mail ("E-mail" incluído depois, mesmo dia).
export default function TipoContatoFields({
  initialTipo,
  contactId,
  contacts,
  companyId,
}: {
  initialTipo?: TaskType | null;
  contactId?: string | null;
  contacts: Contact[];
  // Empresa por trás do Contato — precisa pra cadastrar um contato novo
  // direto daqui quando a empresa escolhida ainda não tem nenhum. Ausente
  // (ex.: "Nova tarefa" antes de escolher uma empresa) esconde o
  // "+ Cadastrar contato".
  companyId?: string | null;
}) {
  const [tipo, setTipo] = useState<TaskType | "">(initialTipo ?? "");
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [selectedContactId, setSelectedContactId] = useState(contactId ?? "");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [decisor, setDecisor] = useState(false);

  // A lista de contatos muda de fora (empresa trocada em "Nova tarefa",
  // via Server Action) — ressincroniza o estado interno e descarta um
  // cadastro em andamento que não faz mais sentido pra outra empresa.
  useEffect(() => {
    setLocalContacts(contacts);
    setSelectedContactId(contactId ?? "");
    setCreating(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  const requiresContact = tipo !== "" && CONTACT_REQUIRED_TASK_TYPES.includes(tipo);

  async function handleCreateContact() {
    if (!companyId) return;
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

  return (
    <>
      <label>
        Tipo
        <select
          name="tipo"
          value={tipo}
          onChange={(event) => setTipo(event.target.value as TaskType | "")}
          required
        >
          <option value="">—</option>
          {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {requiresContact && (
        <div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Contato</label>
          </div>
          <select
            name="contactId"
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
              Nenhum contato cadastrado para esta empresa.
              {companyId && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: 0 }}
                    onClick={() => setCreating(true)}
                  >
                    + Cadastrar contato
                  </button>
                </>
              )}
            </div>
          )}
          {creating && (
            <div className="field" style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {formError && <div className="error-banner">{formError}</div>}
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
    </>
  );
}
