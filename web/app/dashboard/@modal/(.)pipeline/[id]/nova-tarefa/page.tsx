import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import { loadOpportunityDetail } from "@/app/dashboard/pipeline/_detail/load";
import NovaForm from "@/app/dashboard/tarefas/nova/nova-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

// "+ Gerar tarefa" a partir de um card do Pipeline (feature nova, fora do
// SPEC-CRM-GAMA.md original) — reusa o mesmo NovaForm de Tarefas, com o
// vínculo travado na oportunidade de origem (ver prop lockedOpportunityId).
export default async function NovaTarefaDoCardModal({
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
    <OverlayModal title="Gerar tarefa" wide>
      <NovaForm
        lockedOpportunityId={data.opportunity.id}
        lockedLabel={lockedLabel}
        initialContacts={initialContacts}
        initialCompanyId={data.company.id}
        assigneeOptions={assigneeOptions}
        opportunityItems={data.opportunity.items.map((item) => item.name)}
      />
    </OverlayModal>
  );
}
