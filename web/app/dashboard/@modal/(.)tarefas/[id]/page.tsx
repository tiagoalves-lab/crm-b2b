import { getServerAccessToken } from "@/lib/api/auth";
import { loadTaskDetail } from "@/app/dashboard/tarefas/_detail/load";
import { DetailBody, DetailFooter, TaskDetailProvider } from "@/app/dashboard/tarefas/_detail/task-detail";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function TaskDetailModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadTaskDetail(token, id);

  return (
    <TaskDetailProvider data={data} isModal>
      <OverlayModal title={data.task.title} footer={<DetailFooter />} wide>
        <DetailBody />
      </OverlayModal>
    </TaskDetailProvider>
  );
}
