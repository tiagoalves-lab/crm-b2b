import { getServerAccessToken } from "@/lib/api/auth";
import { loadTaskDetail } from "../../_detail/load";
import EditForm from "./edit-form";

export default async function EditarTarefaPage({
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
  const backHref = `/dashboard/tarefas/${id}/editar`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Editar tarefa</div>
          <div className="page-sub">{data.task.title}</div>
        </div>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <EditForm data={data} backHref={backHref} />
        </div>
      </div>
    </>
  );
}
