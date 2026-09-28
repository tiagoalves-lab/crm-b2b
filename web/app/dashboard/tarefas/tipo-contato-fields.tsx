"use client";

import { useEffect, useState } from "react";
import { CONTACT_REQUIRED_TASK_TYPES, TASK_TYPE_LABELS } from "@/lib/api/tasks";
import { isoParaInputLocal } from "@/lib/format-date";
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
// O campo Prazo mora aqui desde 2026-09-23 (pedido do usuário: reunião
// com data E hora). Ele precisa saber o Tipo escolhido — reunião pede
// horário, o resto continua sendo um dia só —, e o Tipo é estado deste
// componente. Deixá-lo fora obrigaria os dois formulários a duplicar essa
// régua e a manter o estado em sincronia.
//
// O que vai no FormData: `dueAt` (texto do input) e `dueHasTime` ("1" ou
// vazio). Quem submete converte o horário de Brasília pra instante ISO
// (inputLocalParaISO) — o <input type="datetime-local"> não carrega fuso.
//
// "Pessoas envolvidas" (2026-09-24, pedido do usuário) mora aqui pelo
// mesmo motivo: só aparece quando o Tipo é Reunião e precisa saber quem
// está no campo Contato pra não oferecer a mesma pessoa duas vezes. Vai
// no FormData como um `participantContactIds` por pessoa marcada.
export default function TipoContatoFields({
  initialTipo,
  contactId,
  contacts,
  companyId,
  initialDueAt,
  initialDueHasTime,
  initialParticipantIds,
}: {
  initialTipo?: TaskType | null;
  contactId?: string | null;
  contacts: Contact[];
  // Pessoas envolvidas já gravadas (só reunião). Ausente = tarefa nova.
  initialParticipantIds?: string[];
  // Prazo salvo (ISO). Ausente = formulário de tarefa nova.
  initialDueAt?: string | null;
  initialDueHasTime?: boolean;
  // Empresa por trás do Contato — precisa pra cadastrar um contato novo
  // direto daqui quando a empresa escolhida ainda não tem nenhum. Ausente
  // (ex.: "Nova tarefa" antes de escolher uma empresa) esconde o
  // "+ Cadastrar contato".
  companyId?: string | null;
}) {
  const [tipo, setTipo] = useState<TaskType | "">(initialTipo ?? "");
  // Reunião marca hora; os outros tipos continuam sendo "um dia". Quem já
  // tem horário salvo mantém o campo com hora mesmo se o tipo mudar — não
  // se apaga um horário combinado sem a pessoa pedir.
  const comHora = tipo === "reuniao" || Boolean(initialDueHasTime);
  const [dueAt, setDueAt] = useState(() => {
    if (!initialDueAt) return "";
    return initialDueHasTime ? isoParaInputLocal(initialDueAt) : initialDueAt.slice(0, 10);
  });

  // Ao alternar entre "com hora" e "sem hora", o texto do input tem
  // formato diferente — converte o que já está digitado em vez de limpar.
  useEffect(() => {
    setDueAt((atual) => {
      if (!atual) return atual;
      if (comHora && atual.length === 10) return `${atual}T09:00`;
      if (!comHora && atual.length > 10) return atual.slice(0, 10);
      return atual;
    });
  }, [comHora]);
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [selectedContactId, setSelectedContactId] = useState(contactId ?? "");
  // Pessoas envolvidas (2026-09-24, pedido do usuário): reunião não é de
  // uma pessoa só. O contato principal fica de fora da lista — ele já
  // está no campo Contato, marcá-lo aqui duplicaria o nome na ficha.
  const [envolvidos, setEnvolvidos] = useState<string[]>(initialParticipantIds ?? []);
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
    setEnvolvidos(initialParticipantIds ?? []);
    setCreating(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  const requiresContact = tipo !== "" && CONTACT_REQUIRED_TASK_TYPES.includes(tipo);
  // Só reunião tem "pessoas envolvidas" — ligação e e-mail são de uma
  // pessoa só, e visita/proposta/follow-up não pediram isso.
  const ehReuniao = tipo === "reuniao";
  const opcoesEnvolvidos = localContacts.filter((c) => c.id !== selectedContactId);
  // Só viaja no submit quem ainda é contato desta empresa (e não virou o
  // contato principal) — id órfão faria o backend recusar o salvamento
  // inteiro por causa de alguém que nem aparece mais na tela.
  const marcados = envolvidos.filter((id) => opcoesEnvolvidos.some((c) => c.id === id));

  function toggleEnvolvido(id: string) {
    setEnvolvidos((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  }

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
      <label>
        Prazo
        <input
          name="dueAt"
          type={comHora ? "datetime-local" : "date"}
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
          required
        />
      </label>
      <input type="hidden" name="dueHasTime" value={comHora ? "1" : ""} />
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
      {ehReuniao && (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Pessoas envolvidas</label>
          </div>
          {opcoesEnvolvidos.length > 0 ? (
            <div className="tag-pick-block">
              <div className="tag-pick-hint">
                Quem mais participa da reunião, além do contato principal.
              </div>
              <div className="tag-pick-row">
                {opcoesEnvolvidos.map((c) => {
                  const on = marcados.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={on ? "tag-pick on" : "tag-pick"}
                      aria-pressed={on}
                      onClick={() => toggleEnvolvido(c.id)}
                    >
                      {c.nome}
                      {c.cargo ? ` — ${c.cargo}` : ""}
                    </button>
                  );
                })}
              </div>
              {marcados.map((id) => (
                <input key={id} type="hidden" name="participantContactIds" value={id} />
              ))}
            </div>
          ) : (
            <div className="field-hint">
              Nenhum outro contato cadastrado para esta empresa.
            </div>
          )}
        </div>
      )}
    </>
  );
}
