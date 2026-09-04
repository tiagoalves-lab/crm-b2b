import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import { loadOpportunityDetail } from "../../_detail/load";
import NovaForm from "../../../tarefas/nova/nova-form";

// Fallback full-page de "+ Gerar tarefa" a partir de um card do Pipeline
// (feature nova, fora do SPEC-CRM-GAMA.md original). Em navegação normal
// dentro do app, essa mesma rota é interceptada e abre como modal — ver
// @modal/(.)pipeline/[id]/nova-tarefa.
export default async function NovaTarefaDoCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const [data, assigneeOptions] = await Promise.all([
    loadOpportunityDetail(token, id),
    resolveAssigneeOptions(token),
  ]);
  const initialContacts = await listContacts(token, data.company.id);
  const lockedLabel = `Oportunidade: ${companyDisplayName(data.company)} — ${data.opportunity.currency} ${Number(data.opportunity.amount).toLocaleString("pt-BR")}`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Gerar tarefa</div>
        </div>
      </div>
      <div className="content">
        <div className="form-panel">
          <NovaForm
            lockedOpportunityId={data.opportunity.id}
            lockedLabel={lockedLabel}
            initialContacts={initialContacts}
            initialCompanyId={data.company.id}
            assigneeOptions={assigneeOptions}
            opportunityItems={data.opportunity.items.map((item) => item.name)}
          />
        </div>
      </div>
    </>
  );
}
