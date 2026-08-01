import { getServerAccessToken } from "@/lib/api/auth";
import { loadTaskDetail } from "@/app/dashboard/tarefas/_detail/load";
import EditForm from "@/app/dashboard/tarefas/[id]/editar/edit-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function EditarTarefaModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const data = await loadTaskDetail(token, id);

  return (
    <OverlayModal title="Editar tarefa" wide>
      {error && <div className="error-banner">{error}</div>}
      <EditForm data={data} backHref={`/dashboard/tarefas/${id}/editar`} />
    </OverlayModal>
  );
}
