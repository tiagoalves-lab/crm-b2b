import { redirect } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { listPipelines } from "@/lib/api/pipelines";
import NovaCard from "./nova-card";

// Fallback full-page do cadastro de oportunidade (acesso direto/refresh).
// Em navegação normal dentro do app, essa mesma rota é interceptada e
// abre como modal — ver @modal/(.)pipeline/nova. Desde 2026-09-04 o
// cadastro usa o MESMO card do detalhe (NovaCard), não um formulário à
// parte.
export default async function NovaOportunidadePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; companyId?: string }>;
}) {
  const { error, companyId } = await searchParams;
  const token = await getServerAccessToken();
  const [{ items: pipelines }, lockedCompany, assigneeOptions] = await Promise.all([
    listPipelines(token),
    companyId ? getCompany(token, companyId) : Promise.resolve(null),
    resolveAssigneeOptions(token),
  ]);
  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  if (!pipeline) redirect("/dashboard/pipeline");

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const initialContacts = lockedCompany ? await listContacts(token, lockedCompany.id) : [];

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Nova oportunidade</div>
          <div className="page-sub">{pipeline.name}</div>
        </div>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="panel">
          <NovaCard
            pipelineId={pipeline.id}
            stages={stages}
            lockedCompanyId={lockedCompany?.id}
            lockedCompanyLabel={lockedCompany ? companyDisplayName(lockedCompany) : undefined}
            frame="page"
            assigneeOptions={assigneeOptions}
            initialContacts={initialContacts}
          />
        </div>
      </div>
    </>
  );
}
