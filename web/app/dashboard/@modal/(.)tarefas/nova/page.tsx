import { getServerAccessToken } from "@/lib/api/auth";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import NovaForm from "@/app/dashboard/tarefas/nova/nova-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function NovaTarefaModal({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const assigneeOptions = await resolveAssigneeOptions(token);

  return (
    <OverlayModal title="Nova tarefa" wide>
      {error && <div className="error-banner">{error}</div>}
      <NovaForm assigneeOptions={assigneeOptions} />
    </OverlayModal>
  );
}
