import { getServerAccessToken } from "@/lib/api/auth";
import { loadTaskDetail } from "@/app/dashboard/tarefas/_detail/load";
import { DetailBody, DetailFooter } from "@/app/dashboard/tarefas/_detail/detail-body";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function TaskDetailModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadTaskDetail(token, id);
  const backHref = `/dashboard/tarefas/${id}`;

  return (
    <OverlayModal title={data.task.title} footer={<DetailFooter data={data} backHref={backHref} />} wide>
      <DetailBody data={data} backHref={backHref} />
    </OverlayModal>
  );
}
