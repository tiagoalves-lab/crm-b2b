import type { Stage } from "@/lib/api/types";
import CompanyPicker from "../company-picker";
import { createOpportunityAction } from "../actions";

// Compartilhado entre a versão full-page e a versão modal de "Nova
// oportunidade" — protótipo: openDealForm.
export default function NovaForm({
  pipelineId,
  stages,
  backHref,
}: {
  pipelineId: string;
  stages: Stage[];
  backHref: string;
}) {
  return (
    <form action={createOpportunityAction} className="form-grid">
      <input type="hidden" name="pipelineId" value={pipelineId} />
      <input type="hidden" name="back" value={backHref} />
      <div style={{ gridColumn: "1 / -1" }}>
        <div className="field" style={{ marginBottom: 6 }}>
          <label>
            Empresa <span style={{ color: "var(--danger)" }}>*</span>
          </label>
        </div>
        <CompanyPicker />
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
      <button type="submit" className="btn btn-primary">
        Criar oportunidade
      </button>
    </form>
  );
}
