import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { listTaskLists } from "@/lib/api/task-lists";
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
  const [data, taskLists] = await Promise.all([
    loadOpportunityDetail(token, id),
    listTaskLists(token),
  ]);
  const lockedLabel = `Oportunidade: ${companyDisplayName(data.company)} — ${data.opportunity.currency} ${Number(data.opportunity.amount).toLocaleString("pt-BR")}`;

  return (
    <OverlayModal title="Gerar tarefa" wide>
      <NovaForm
        taskLists={taskLists}
        companies={[]}
        opportunities={[data.opportunity]}
        lockedOpportunityId={data.opportunity.id}
        lockedLabel={lockedLabel}
      />
    </OverlayModal>
  );
}
