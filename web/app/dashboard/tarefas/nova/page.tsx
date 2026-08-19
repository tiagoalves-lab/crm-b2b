import { getServerAccessToken } from "@/lib/api/auth";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import NovaForm from "./nova-form";

export default async function NovaTarefaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const assigneeOptions = await resolveAssigneeOptions(token);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Nova tarefa</div>
        </div>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <NovaForm assigneeOptions={assigneeOptions} />
        </div>
      </div>
    </>
  );
}
