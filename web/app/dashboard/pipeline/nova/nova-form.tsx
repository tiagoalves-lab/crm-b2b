"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { Stage } from "@/lib/api/types";
import CompanyPicker from "../company-picker";
import { createOpportunityAction } from "../actions";
import SubmitButton from "@/app/_components/submit-button";

// Compartilhado entre a versão full-page e a versão modal de "Nova
// oportunidade" — protótipo: openDealForm. Fecha via router.back() depois
// de criar — ver comentário em empresas/company-form.tsx sobre por que
// back() e não push()/redirect(); toast via sessionStorage porque back()
// não aceita querystring.
export default function NovaForm({
  pipelineId,
  stages,
  lockedCompanyId,
  lockedCompanyLabel,
}: {
  pipelineId: string;
  stages: Stage[];
  // Preenchidos quando o form é aberto a partir da ficha de um lead recém
  // aprovado ("Aprovar para Lead" → "Sim, cadastrar oportunidade") — trava
  // o vínculo na empresa que acabou de ser criada em vez de deixar o
  // usuário buscar de novo no CompanyPicker. Mesmo padrão de
  // lockedOpportunityId em tarefas/nova/nova-form.tsx.
  lockedCompanyId?: string;
  lockedCompanyLabel?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createOpportunityAction, null);
  useEffect(() => {
    if (state?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, "Oportunidade criada");
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
      <input type="hidden" name="pipelineId" value={pipelineId} />
      <div style={{ gridColumn: "1 / -1" }}>
        <div className="field" style={{ marginBottom: 6 }}>
          <label>
            Empresa <span style={{ color: "var(--danger)" }}>*</span>
          </label>
        </div>
        {lockedCompanyId ? (
          <>
            <input type="hidden" name="companyId" value={lockedCompanyId} />
            <div className="field-hint">{lockedCompanyLabel}</div>
          </>
        ) : (
          <CompanyPicker />
        )}
      </div>
      <label>
        Etapa
        <select name="stageId" required defaultValue={stages[0]?.id ?? ""}>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valor (R$)
        <input name="amount" type="number" step="0.01" min="0" required placeholder="180000" />
      </label>
      <label>
        Moeda
        <input name="currency" defaultValue="BRL" maxLength={3} />
      </label>
      <label>
        Previsão de fechamento
        <input name="expectedCloseDate" type="date" />
      </label>
      <SubmitButton className="btn btn-primary" pendingLabel="Criando…">
        Criar oportunidade
      </SubmitButton>
    </form>
  );
}
