"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { AssigneeOption } from "@/lib/api/assignee-options";
import type { Contact } from "@/lib/api/types";
import { createTaskModalAction, createTaskNoCardAction, listCompanyContactsAction } from "../actions";
import TipoContatoFields from "../tipo-contato-fields";
import CompanyPicker from "../../pipeline/company-picker";
import { TagPicker } from "../../pipeline/_detail/item-tags";
import SubmitButton from "@/app/_components/submit-button";
import { ArquivosPendentes } from "@/app/dashboard/_overlay/arquivos-pendentes";
import { enviarAnexosTarefa } from "../_detail/enviar-anexos";

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
  opportunityItems,
  onCreated,
  onCancel,
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
  // Qualquer membro ativo, quem está criando primeiro — resolvido no
  // servidor (web/lib/api/assignee-options.ts).
  assigneeOptions: AssigneeOption[];
  // Itens da oportunidade de origem (só com lockedOpportunityId,
  // 2026-09-04) — viram chips pra carimbar na tarefa que está nascendo.
  opportunityItems?: string[];
  // Embutido no card da oportunidade (2026-10-29): em vez de fechar a
  // tela com back(), avisa quem abriu — o card segue aberto.
  onCreated?: (mensagem: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(onCreated ? createTaskNoCardAction : createTaskModalAction, null);
  const [contacts, setContacts] = useState<Contact[]>(initialContacts ?? []);
  const [tags, setTags] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState(initialCompanyId ?? lockedCompanyId ?? "");
  // Anexos ficam fora do formulário (2026-10-28) e sobem pelo navegador
  // depois que a tarefa nasce — mesmo molde de pipeline/nova/nova-card.tsx.
  const [files, setFiles] = useState<File[]>([]);
  const [enviandoAnexos, setEnviandoAnexos] = useState(false);
  useEffect(() => {
    if (!state?.ok) return;
    const { taskId } = state;
    let cancelado = false;
    async function concluir() {
      let mensagem = "Tarefa criada";
      if (files.length > 0) {
        setEnviandoAnexos(true);
        const { falhas } = await enviarAnexosTarefa(taskId, files);
        if (falhas.length > 0) {
          mensagem = `Tarefa criada, mas não deu pra enviar: ${falhas.join("; ")}. Abra a tarefa e anexe de novo.`;
        }
      }
      if (cancelado) return;
      if (onCreated) {
        onCreated(mensagem);
        return;
      }
      sessionStorage.setItem(TOAST_SESSION_KEY, mensagem);
      // Mesma marca de refresh do cadastro de oportunidade (2026-09-15):
      // sem ela a tarefa nova só aparecia na lista depois de um F5.
      sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
      router.back();
    }
    void concluir();
    return () => {
      cancelado = true;
    };
    // `files` fica de fora de propósito: só o resultado do submit dispara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  async function loadContactsFor(nextCompanyId: string) {
    setCompanyId(nextCompanyId);
    setContacts(nextCompanyId ? await listCompanyContactsAction(nextCompanyId) : []);
  }

  return (
    <form action={formAction} className="form-grid">
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
      {opportunityItems && opportunityItems.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Itens da oportunidade (carimbar na tarefa)</label>
          </div>
          <TagPicker options={opportunityItems} selected={tags} onChange={setTags} name="tags" />
        </div>
      )}
      {/* Prazo saiu daqui em 2026-09-23: o formato dele depende do Tipo
          (reunião tem hora), e o Tipo é estado do TipoContatoFields. */}
      <TipoContatoFields contacts={contacts} companyId={companyId} />
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
        <div className="drawer-section-title">Anexos (opcional)</div>
        <ArquivosPendentes files={files} onChange={setFiles} />
      </div>
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={enviandoAnexos}>
            Cancelar
          </button>
        )}
        {enviandoAnexos ? (
          <button type="button" className="btn btn-primary" disabled aria-busy>
            Enviando anexos…
          </button>
        ) : (
          <SubmitButton className="btn btn-primary" pendingLabel="Criando…">
            Criar tarefa
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
