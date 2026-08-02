import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import { listTaskLists } from "@/lib/api/task-lists";
import NovaForm from "./nova-form";

export default async function NovaTarefaPage({
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
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Nova tarefa</div>
        </div>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <NovaForm taskLists={taskLists} companies={companies} opportunities={opportunities} />
        </div>
      </div>
    </>
  );
}
