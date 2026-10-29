"use client";

import { useEffect, useMemo, useState } from "react";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { CONTACT_REQUIRED_ACTIVITY_SUBTIPOS } from "@/lib/api/activities";
import {
  dataDoAtalho,
  detectarDataNoTexto,
  rotuloDataRetorno,
  type AtalhoRetorno,
} from "@/lib/detectar-data";
import { dayKeyBR, inputLocalParaISO } from "@/lib/format-date";
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
//
// "Retomar contato" (pedido do usuário, 2026-10-28): o vendedor escrevia
// "contatar novamente em janeiro" e não criava tarefa. Atalhos de data
// logo abaixo do texto criam o lembrete no mesmo clique do Registrar; e
// se o texto menciona uma data futura (lib/detectar-data.ts), a tela
// sugere o lembrete — e pergunta de novo no Registrar se a pessoa não
// escolheu nada.
type Retorno = "nenhum" | AtalhoRetorno | "data";

const ATALHOS_RETORNO: Array<{ value: Retorno; label: string }> = [
  { value: "nenhum", label: "Sem retorno" },
  { value: "7d", label: "Em 7 dias" },
  { value: "30d", label: "Em 30 dias" },
  { value: "3m", label: "Em 3 meses" },
  { value: "data", label: "Escolher data" },
];

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
  // Data/hora da reunião (2026-09-23) — texto do <input
  // type="datetime-local">, no horário de Brasília. Vazio = reunião que
  // já aconteceu: registra na Timeline e não cria tarefa.
  const [reuniaoEm, setReuniaoEm] = useState("");
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
  const [retorno, setRetorno] = useState<Retorno>("nenhum");
  const [retornoData, setRetornoData] = useState("");
  // Registrar com data no texto e "Sem retorno" marcado pede confirmação
  // uma vez; "Registrar sem lembrete" deixa passar.
  const [confirmarSemRetorno, setConfirmarSemRetorno] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const hoje = dayKeyBR(new Date());
  const mencionada = useMemo(() => detectarDataNoTexto(texto, hoje), [texto, hoje]);
  // Reunião com data marcada já vira tarefa sozinha — o retorno sairia
  // duplicado (e a data da reunião no texto dispararia a sugestão).
  const mostraRetorno = !(subtipo === "reuniao" && reuniaoEm);
  const retornoEm = !mostraRetorno
    ? ""
    : retorno === "nenhum"
      ? ""
      : retorno === "data"
        ? retornoData
        : dataDoAtalho(retorno, hoje);

  useEffect(() => {
    setConfirmarSemRetorno(false);
    if (texto) setAviso(null);
  }, [texto]);

  useEffect(() => {
    setLocalContacts(contacts);
  }, [contacts]);

  const requiresContact = CONTACT_REQUIRED_ACTIVITY_SUBTIPOS.includes(subtipo);
  const ehReuniao = subtipo === "reuniao";

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

  function usarDataMencionada(data: string) {
    setRetorno("data");
    setRetornoData(data);
  }

  async function registrar(dataRetorno: string) {
    const trimmedTexto = texto.trim();
    if (!trimmedTexto) {
      setFormError("Escreva algo antes de registrar.");
      return;
    }
    if (requiresContact && !selectedContactId) {
      setFormError("Selecione um contato.");
      return;
    }
    if (mostraRetorno && retorno === "data" && !dataRetorno) {
      setFormError("Escolha a data do retorno.");
      return;
    }
    if (dataRetorno && dataRetorno <= hoje) {
      setFormError("A data do retorno precisa ser depois de hoje.");
      return;
    }
    setBusy(true);
    setFormError(null);
    setAviso(null);
    const res = await createNoteRpcAction(companyId, {
      subtipo,
      texto: trimmedTexto,
      contactId: selectedContactId || undefined,
      // Só a reunião agenda; nos outros tipos o campo nem aparece.
      reuniaoEm: ehReuniao && reuniaoEm ? inputLocalParaISO(reuniaoEm) : undefined,
      contatoNome: localContacts.find((c) => c.id === selectedContactId)?.nome,
      retornoEm: dataRetorno || undefined,
    });
    setBusy(false);
    setConfirmarSemRetorno(false);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setTexto("");
    setSelectedContactId("");
    setReuniaoEm("");
    setRetorno("nenhum");
    setRetornoData("");
    if (dataRetorno) setAviso(`Lembrete criado em Tarefas para ${rotuloDataRetorno(dataRetorno)}.`);
    refresh();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mostraRetorno && !retornoEm && retorno !== "data" && mencionada && texto.trim()) {
      setConfirmarSemRetorno(true);
      return;
    }
    await registrar(retornoEm);
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
      {ehReuniao && (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="reuniao-em">Data e hora da reunião</label>
          <input
            id="reuniao-em"
            type="datetime-local"
            value={reuniaoEm}
            onChange={(event) => setReuniaoEm(event.target.value)}
          />
          <div className="field-hint">
            Preenchido, cria a reunião em Tarefas com esse horário. Deixe em branco se a reunião já
            aconteceu.
          </div>
        </div>
      )}
      <textarea value={texto} onChange={(event) => setTexto(event.target.value)} placeholder={placeholder} />
      {mostraRetorno && mencionada && retornoEm !== mencionada.data && !confirmarSemRetorno && (
        <div className="retorno-sugestao">
          <span>
            Você mencionou <strong>“{mencionada.trecho}”</strong>. Criar lembrete para{" "}
            <strong>{rotuloDataRetorno(mencionada.data)}</strong>?
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => usarDataMencionada(mencionada.data)}
          >
            Usar esta data
          </button>
        </div>
      )}
      {mostraRetorno && (
        <div className="retorno-campo">
          <span className="retorno-titulo">Retomar contato</span>
          <div className="add-note-types" style={{ marginBottom: 0 }}>
            {ATALHOS_RETORNO.map(({ value, label }) => (
              <label key={value} className="note-type-btn">
                <input
                  type="radio"
                  name="retorno"
                  value={value}
                  checked={retorno === value}
                  style={{ display: "none" }}
                  onChange={() => setRetorno(value)}
                />
                {label}
              </label>
            ))}
          </div>
          {retorno === "data" && (
            <input
              type="date"
              className="retorno-data"
              value={retornoData}
              onChange={(event) => setRetornoData(event.target.value)}
            />
          )}
          {retornoEm && (
            <div className="field-hint">
              Cria uma tarefa em Tarefas para <strong>{rotuloDataRetorno(retornoEm)}</strong>.
            </div>
          )}
        </div>
      )}
      {confirmarSemRetorno && mencionada && (
        <div className="retorno-confirmar">
          <div>
            Você mencionou <strong>“{mencionada.trecho}”</strong> mas não marcou o retorno. Criar o
            lembrete para <strong>{rotuloDataRetorno(mencionada.data)}</strong>?
          </div>
          <div className="row-form">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void registrar(mencionada.data)}
            >
              Criar lembrete e registrar
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => void registrar("")}
            >
              Registrar sem lembrete
            </button>
          </div>
        </div>
      )}
      {formError && <div className="error-banner">{formError}</div>}
      {aviso && <div className="retorno-aviso">{aviso}</div>}
      <div className="add-note-foot">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Registrando…" : "Registrar"}
        </button>
      </div>
    </form>
  );
}
