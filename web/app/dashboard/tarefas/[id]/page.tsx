import { getServerAccessToken } from "@/lib/api/auth";
import { loadTaskDetail } from "../_detail/load";
import { DetailBody, DetailFooter } from "../_detail/detail-body";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadTaskDetail(token, id);
  const backHref = `/dashboard/tarefas/${id}`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">{data.task.title}</div>
          <div className="page-sub">Tarefa</div>
        </div>
      </div>
      <div className="content">
        <div className="panel">
          <div className="panel-body">
            <DetailBody data={data} backHref={backHref} />
          </div>
          <div className="modal-foot">
            <DetailFooter data={data} backHref={backHref} />
          </div>
        </div>
      </div>
    </>
  );
}
