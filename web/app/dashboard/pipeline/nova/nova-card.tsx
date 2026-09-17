"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { AssigneeOption } from "@/lib/api/assignee-options";
import type { Contact, Stage } from "@/lib/api/types";
import SubmitButton from "@/app/_components/submit-button";
import CompanyPicker from "../company-picker";
import { createOpportunityAction } from "../actions";
import { listCompanyContactsAction } from "../../tarefas/actions";
import TipoContatoFields from "../../tarefas/tipo-contato-fields";
import { ItemsPanel, TagPicker } from "../_detail/item-tags";
import { enviarAnexosOportunidade } from "../_detail/enviar-anexos";

// Cadastro de oportunidade no MESMO card do detalhe (pedido do usuário,
// 2026-09-04): o formulário pequeno que existia antes (nova-form.tsx)
// foi removido. Aqui as seções do card — Empresa/Valor/Previsão, Anexos,
// Comentários, Tarefa e a lista lateral de Itens — só que editáveis;
// tudo viaja num único submit pra createOpportunityAction, que cria a
// oportunidade e em seguida grava comentário inicial (com as tags
// escolhidas), anexo inicial e a tarefa (vinculada à oportunidade que
// acabou de nascer), mesma dança de tarefas/nova/nova-form.tsx.
//
// Sem Etapa nem Ponderado (pedido do usuário, 2026-09-04): toda
// oportunidade nasce na primeira coluna do quadro e é arrastando o card
// lá que ela muda de etapa.
//
// Fecha via router.back() (ver comentário em empresas/company-form.tsx);
// toast via sessionStorage.
export default function NovaCard({
  pipelineId,
  stages,
  lockedCompanyId,
  lockedCompanyLabel,
  frame,
  assigneeOptions,
  initialContacts,
}: {
  pipelineId: string;
  stages: Stage[];
  // Preenchidos quando o card é aberto a partir da ficha de um lead recém
  // aprovado ("Aprovar para Lead" → "Sim, cadastrar oportunidade") — trava
  // o vínculo na empresa que acabou de ser criada.
  lockedCompanyId?: string;
  lockedCompanyLabel?: string;
  // "modal": rodapé cola na borda do OverlayModal; "page": corpo e rodapé
  // ganham o mesmo painel da versão full-page do detalhe.
  frame: "modal" | "page";
  // Responsável da tarefa opcional — só o próprio representante ou o
  // gerente dele (web/lib/api/assignee-options.ts).
  assigneeOptions: AssigneeOption[];
  // Contatos da empresa travada (lockedCompanyId); sem trava, a lista é
  // buscada conforme a empresa é escolhida no seletor.
  initialContacts?: Contact[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createOpportunityAction, null);
  const [items, setItems] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [taskTags, setTaskTags] = useState<string[]>([]);
  const [withTask, setWithTask] = useState(false);
  const [companyId, setCompanyId] = useState(lockedCompanyId ?? "");
  const [contacts, setContacts] = useState<Contact[]>(initialContacts ?? []);
  const firstStageId = stages[0]?.id ?? "";

  // Anexos escolhidos ficam aqui, fora do formulário (2026-09-17): dentro
  // do submit eles estouravam o limite de 1 MB da Server Action. Depois
  // que a oportunidade nasce, sobem pelo navegador (enviar-anexos.ts).
  const [files, setFiles] = useState<File[]>([]);
  const [enviandoAnexos, setEnviandoAnexos] = useState(false);

  useEffect(() => {
    if (!state?.ok) return;
    const { opportunityId, toast } = state.data;
    let cancelado = false;
    async function concluir() {
      let mensagem = toast;
      if (files.length > 0) {
        setEnviandoAnexos(true);
        const { falhas } = await enviarAnexosOportunidade(opportunityId, files);
        if (falhas.length > 0) {
          mensagem = `${toast}, mas não deu pra enviar: ${falhas.join("; ")}. Abra o card e anexe de novo.`;
        }
      }
      if (cancelado) return;
      sessionStorage.setItem(TOAST_SESSION_KEY, mensagem);
      // Marca de refresh pendente (2026-09-15): fechar o modal com
      // router.back() volta pro quadro do cache do cliente, e a
      // oportunidade recém-criada só aparecia com F5. O Toast dispara um
      // refresh só ao aterrissar no quadro, já sem overlay na tela —
      // mais barato que refrescar com o card ainda aberto.
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

  function addItem(name: string): boolean {
    const key = name.toLocaleLowerCase("pt-BR");
    if (items.some((item) => item.toLocaleLowerCase("pt-BR") === key)) return false;
    setItems([...items, name]);
    return true;
  }

  function removeItem(name: string) {
    setItems(items.filter((item) => item !== name));
    setTags(tags.filter((tag) => tag !== name));
    setTaskTags(taskTags.filter((tag) => tag !== name));
  }

  const body = (
    <>
      {state?.ok === false && <div className="error-banner">{state.message}</div>}
      <div className="opp-grid">
        <div className="opp-main">
          <dl className="kv kv-form">
            <dt>
              Empresa <span style={{ color: "var(--danger)" }}>*</span>
            </dt>
            <dd>
              {lockedCompanyId ? (
                <>
                  <input type="hidden" name="companyId" value={lockedCompanyId} />
                  <span>{lockedCompanyLabel}</span>
                </>
              ) : (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CompanyPicker onPick={loadContactsFor} />
                </div>
              )}
            </dd>
            {/* Moeda saiu do formulário (pedido do usuário, 2026-09-11):
                tudo é negociado em real. O backend continua guardando a
                moeda, com "BRL" como padrão. */}
            <dt>Valor</dt>
            <dd>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="0,00"
                aria-label="Valor"
                style={{ width: 170, fontFamily: "var(--font-mono)" }}
              />
            </dd>
            <dt>Previsão</dt>
            <dd>
              <input name="expectedCloseDate" type="date" aria-label="Previsão de fechamento" />
            </dd>
          </dl>

          {/* Descrição longa (2026-09-04): o mesmo campo do card de
              detalhe, pra solicitação nascer já detalhada. */}
          <label className="opp-desc-field">
            Descrição
            <textarea
              name="description"
              rows={8}
              placeholder="Detalhe o que está sendo negociado: modelo, opcionais, condições, prazos…"
            />
          </label>

          <div className="task-detail-section">
            <div className="drawer-section-title" style={{ marginTop: 0 }}>
              Anexos
            </div>
            <div className="attach-drop" style={{ cursor: "default" }}>
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              <div className="attach-drop-text" style={{ marginBottom: 10 }}>
                Anexar arquivos (foto, PDF, planilha) — opcional
              </div>
              <div className="row-form" style={{ justifyContent: "center" }}>
                <input
                  type="file"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                />
              </div>
            </div>
          </div>

          <div className="task-detail-section">
            <div className="drawer-section-title">Comentários</div>
            <TagPicker
              options={items}
              selected={tags}
              onChange={setTags}
              name="tags"
              hint="Carimbar itens no comentário:"
            />
            <div className="chat-input-row">
              <textarea name="comment" placeholder="Primeiro comentário (opcional)..." rows={2} />
            </div>
          </div>

          <div className="task-detail-section">
            <div className="drawer-section-title">Tarefa</div>
            {!withTask ? (
              <div className="row-form" style={{ alignItems: "center", gap: 10 }}>
                <button type="button" className="btn btn-sm" onClick={() => setWithTask(true)}>
                  + Cadastrar tarefa
                </button>
                <span className="field-hint" style={{ marginTop: 0 }}>
                  Opcional — nasce vinculada a esta oportunidade.
                </span>
              </div>
            ) : (
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Descrição*
                  <input name="taskTitle" required placeholder="Ex: Ligar para retorno da proposta" />
                </label>
                {items.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div className="field" style={{ marginBottom: 6 }}>
                      <label>Itens da oportunidade (carimbar na tarefa)</label>
                    </div>
                    <TagPicker options={items} selected={taskTags} onChange={setTaskTags} name="taskTags" />
                  </div>
                )}
                <TipoContatoFields contacts={contacts} companyId={companyId || undefined} />
                <label>
                  Prazo
                  <input name="taskDueAt" type="date" required />
                </label>
                <label>
                  Responsável
                  <select name="taskAssigneeUserId" defaultValue={assigneeOptions[0]?.userId ?? ""} required>
                    {assigneeOptions.map((option) => (
                      <option key={option.userId} value={option.userId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ gridColumn: "1 / -1" }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWithTask(false)}>
                    Remover tarefa
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="opp-side">
          <ItemsPanel
            items={items.map((name) => ({ key: name, name }))}
            onAdd={addItem}
            onRemove={(item) => removeItem(item.name)}
          />
        </aside>
      </div>
    </>
  );

  return (
    <form action={formAction} encType="multipart/form-data">
      <input type="hidden" name="pipelineId" value={pipelineId} />
      <input type="hidden" name="stageId" value={firstStageId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {frame === "page" ? <div className="panel-body">{body}</div> : body}
      <div className={frame === "modal" ? "modal-foot opp-foot-modal" : "modal-foot"}>
        {frame === "modal" ? (
          <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
            Fechar
          </button>
        ) : (
          <Link href="/dashboard/pipeline" className="btn btn-ghost">
            Fechar
          </Link>
        )}
        {enviandoAnexos ? (
          <button type="button" className="btn btn-primary" disabled aria-busy>
            Enviando anexos…
          </button>
        ) : (
          <SubmitButton className="btn btn-primary" pendingLabel="Criando…">
            Criar oportunidade
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
