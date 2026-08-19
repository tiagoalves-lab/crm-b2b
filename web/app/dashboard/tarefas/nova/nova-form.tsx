"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { AssigneeOption } from "@/lib/api/assignee-options";
import type { Contact } from "@/lib/api/types";
import { createTaskModalAction, listCompanyContactsAction } from "../actions";
import TipoContatoFields from "../tipo-contato-fields";
import CompanyPicker from "../../pipeline/company-picker";
import SubmitButton from "@/app/_components/submit-button";

// Compartilhado entre a versão full-page e a versão modal de "Nova
// tarefa" (protótipo: openTaskForm sem id). Fecha via router.back() depois
// de criar — ver comentário em company-form.tsx sobre por que back() e não
// push()/redirect(); toast via sessionStorage porque back() não aceita
// querystring.
export default function NovaForm({
  lockedOpportunityId,
  lockedCompanyId,
  lockedLabel,
  initialContacts,
  initialCompanyId,
  assigneeOptions,
}: {
  // Preenchidos quando o form é aberto de dentro de um card do Pipeline
  // ("+ Gerar tarefa") — trava o vínculo na oportunidade de origem em vez
  // de deixar o usuário escolher de novo.
  lockedOpportunityId?: string;
  // Preenchido quando o form é aberto de dentro da ficha de um lead/
  // empresa na Prospecção ("Criar tarefa") — trava o vínculo na empresa
  // de origem, mesma ideia de lockedOpportunityId só que por Empresa em
  // vez de Oportunidade (pedido do usuário, 2026-08-04). Aqui no menu
  // Tarefas puro (sem nenhum dos dois locked) o vínculo é escolhido pelo
  // usuário via Empresa (CompanyPicker) — Oportunidade só existe vindo
  // do Pipeline.
  lockedCompanyId?: string;
  lockedLabel?: string;
  // Contatos da empresa por trás de lockedOpportunityId/lockedCompanyId,
  // já resolvidos pelo servidor (empresa fixa nesses caminhos). Sem
  // nenhum dos dois, a lista começa vazia e é buscada via Server Action
  // conforme o usuário escolhe a Empresa.
  initialContacts?: Contact[];
  // Empresa por trás de lockedOpportunityId/lockedCompanyId (mesmo
  // caminho acima) — usado só pra permitir cadastrar um contato novo
  // direto do combobox de Contato quando a lista vier vazia
  // (TipoContatoFields).
  initialCompanyId?: string;
  // Só o próprio representante (quem está criando) ou o gerente dele —
  // resolvido no servidor (web/lib/api/assignee-options.ts).
  assigneeOptions: AssigneeOption[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createTaskModalAction, null);
  const [contacts, setContacts] = useState<Contact[]>(initialContacts ?? []);
  const [companyId, setCompanyId] = useState(initialCompanyId ?? lockedCompanyId ?? "");
  useEffect(() => {
    if (state?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, "Tarefa criada");
      router.back();
    }
  }, [state, router]);

  async function loadContactsFor(nextCompanyId: string) {
    setCompanyId(nextCompanyId);
    setContacts(nextCompanyId ? await listCompanyContactsAction(nextCompanyId) : []);
  }

  return (
    <form action={formAction} className="form-grid" encType="multipart/form-data">
      {state?.ok === false && (
        <div className="error-banner" style={{ gridColumn: "1 / -1" }}>
          {state.message}
        </div>
      )}
      <label style={{ gridColumn: "1 / -1" }}>
        Descrição*
        <input name="title" required placeholder="Ex: Ligar para retorno da proposta" />
      </label>
      {lockedOpportunityId ? (
        <>
          <input type="hidden" name="opportunityId" value={lockedOpportunityId} />
          <div style={{ gridColumn: "1 / -1" }} className="field-hint">
            {lockedLabel}
          </div>
        </>
      ) : lockedCompanyId ? (
        <>
          <input type="hidden" name="companyId" value={lockedCompanyId} />
          <div style={{ gridColumn: "1 / -1" }} className="field-hint">
            {lockedLabel}
          </div>
        </>
      ) : (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Empresa</label>
          </div>
          <CompanyPicker onPick={loadContactsFor} />
        </div>
      )}
      <TipoContatoFields contacts={contacts} companyId={companyId} />
      <label>
        Prazo
        <input name="dueAt" type="date" required />
      </label>
      <label>
        Responsável
        <select name="assigneeUserId" defaultValue={assigneeOptions[0]?.userId ?? ""} required>
          {assigneeOptions.map((option) => (
            <option key={option.userId} value={option.userId}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="task-detail-section" style={{ gridColumn: "1 / -1" }}>
        <div className="drawer-section-title" style={{ marginTop: 0 }}>
          Comentário inicial (opcional)
        </div>
        <div className="chat-input-row">
          <textarea name="comment" placeholder="Escrever comentário..." rows={2} />
        </div>
      </div>
      <div className="task-detail-section" style={{ gridColumn: "1 / -1" }}>
        <div className="drawer-section-title">Anexo (opcional)</div>
        <input type="file" name="file" />
      </div>
      <SubmitButton className="btn btn-primary" pendingLabel="Criando…">
        Criar tarefa
      </SubmitButton>
    </form>
  );
}
