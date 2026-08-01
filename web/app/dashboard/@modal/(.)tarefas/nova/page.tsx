import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listTaskLists } from "@/lib/api/task-lists";
import NovaForm from "@/app/dashboard/tarefas/nova/nova-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function NovaTarefaModal({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const [taskLists, { items: companies }, { items: opportunities }] = await Promise.all([
    listTaskLists(token),
    listCompanies(token),
    listOpportunities(token),
  ]);

  return (
    <OverlayModal title="Nova tarefa" wide>
      {error && <div className="error-banner">{error}</div>}
      <NovaForm taskLists={taskLists} companies={companies} opportunities={opportunities} backHref="/dashboard/tarefas/nova" />
    </OverlayModal>
  );
}
