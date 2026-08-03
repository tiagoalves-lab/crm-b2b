import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { listTaskLists } from "@/lib/api/task-lists";
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
  const [data, taskLists] = await Promise.all([
    loadOpportunityDetail(token, id),
    listTaskLists(token),
  ]);
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
            taskLists={taskLists}
            companies={[]}
            opportunities={[data.opportunity]}
            lockedOpportunityId={data.opportunity.id}
            lockedLabel={lockedLabel}
          />
        </div>
      </div>
    </>
  );
}
