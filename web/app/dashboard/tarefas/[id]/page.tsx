import { getServerAccessToken } from "@/lib/api/auth";
import { loadTaskDetail } from "../_detail/load";
import { DetailBody, DetailFooter, TaskDetailProvider } from "../_detail/task-detail";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadTaskDetail(token, id);

  return (
    <TaskDetailProvider data={data} isModal={false}>
      <div className="topbar">
        <div>
          <div className="page-title">{data.task.title}</div>
          <div className="page-sub">Tarefa</div>
        </div>
      </div>
      <div className="content">
        <div className="panel">
          <div className="panel-body">
            <DetailBody />
          </div>
          <div className="modal-foot">
            <DetailFooter />
          </div>
        </div>
      </div>
    </TaskDetailProvider>
  );
}
