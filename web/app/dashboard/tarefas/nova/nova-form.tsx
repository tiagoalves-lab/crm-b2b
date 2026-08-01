import type { Company, Opportunity, TaskList } from "@/lib/api/types";
import { createTaskAction } from "../actions";

// Compartilhado entre a versão full-page e a versão modal de "Nova
// tarefa" (protótipo: openTaskForm sem id).
export default function NovaForm({
  taskLists,
  companies,
  opportunities,
  backHref,
}: {
  taskLists: TaskList[];
  companies: Company[];
  opportunities: Opportunity[];
  backHref: string;
}) {
  return (
    <form action={createTaskAction} className="form-grid">
      <input type="hidden" name="back" value={backHref} />
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
      <label>
        Empresa
        <select name="companyId" defaultValue="">
          <option value="">—</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
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
            .map((opp) => (
              <option key={opp.id} value={opp.id}>
                {companies.find((c) => c.id === opp.companyId)?.name ?? opp.id} — {opp.currency}{" "}
                {Number(opp.amount).toLocaleString("pt-BR")}
              </option>
            ))}
        </select>
      </label>
      <div style={{ gridColumn: "1 / -1" }} className="field-hint">
        Escolha exatamente um vínculo (empresa OU oportunidade).
      </div>
      <button type="submit" className="btn btn-primary">
        Criar tarefa
      </button>
    </form>
  );
}
