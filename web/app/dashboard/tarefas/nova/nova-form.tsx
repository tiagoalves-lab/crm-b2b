"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import { companyDisplayName } from "@/lib/api/companies";
import type { Company, Opportunity, TaskList } from "@/lib/api/types";
import { createTaskModalAction } from "../actions";

// Compartilhado entre a versão full-page e a versão modal de "Nova
// tarefa" (protótipo: openTaskForm sem id). Fecha via router.back() depois
// de criar — ver comentário em company-form.tsx sobre por que back() e não
// push()/redirect(); toast via sessionStorage porque back() não aceita
// querystring.
export default function NovaForm({
  taskLists,
  companies,
  opportunities,
  lockedOpportunityId,
  lockedLabel,
}: {
  taskLists: TaskList[];
  companies: Company[];
  opportunities: Opportunity[];
  // Preenchidos quando o form é aberto de dentro de um card do Pipeline
  // ("+ Gerar tarefa") — trava o vínculo na oportunidade de origem em vez
  // de deixar o usuário escolher de novo nos <select>.
  lockedOpportunityId?: string;
  lockedLabel?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createTaskModalAction, null);
  useEffect(() => {
    if (state?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, "Tarefa criada");
      router.back();
    }
  }, [state, router]);

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
      <label>
        Prazo
        <input name="dueAt" type="date" />
      </label>
      <label>
        Coluna
        <select name="listId" defaultValue={taskLists.find((l) => l.order === 0)?.id ?? ""}>
          {[...taskLists]
            .sort((a, b) => a.order - b.order)
            .map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
        </select>
      </label>
      {lockedOpportunityId ? (
        <>
          <input type="hidden" name="opportunityId" value={lockedOpportunityId} />
          <div style={{ gridColumn: "1 / -1" }} className="field-hint">
            {lockedLabel}
          </div>
        </>
      ) : (
        <>
          <label>
            Empresa
            <select name="companyId" defaultValue="">
              <option value="">—</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {companyDisplayName(company)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Oportunidade
            <select name="opportunityId" defaultValue="">
              <option value="">—</option>
              {opportunities
                .filter((opp) => !opp.deletedAt)
                .map((opp) => {
                  const oppCompany = companies.find((c) => c.id === opp.companyId);
                  return (
                    <option key={opp.id} value={opp.id}>
                      {oppCompany ? companyDisplayName(oppCompany) : opp.id} — {opp.currency}{" "}
                      {Number(opp.amount).toLocaleString("pt-BR")}
                    </option>
                  );
                })}
            </select>
          </label>
          <div style={{ gridColumn: "1 / -1" }} className="field-hint">
            Escolha exatamente um vínculo (empresa OU oportunidade).
          </div>
        </>
      )}
      <button type="submit" className="btn btn-primary">
        Criar tarefa
      </button>
    </form>
  );
}
