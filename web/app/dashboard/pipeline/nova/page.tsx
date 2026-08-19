import { redirect } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { listPipelines } from "@/lib/api/pipelines";
import NovaForm from "./nova-form";

export default async function NovaOportunidadePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; companyId?: string }>;
}) {
  const { error, companyId } = await searchParams;
  const token = await getServerAccessToken();
  const [{ items: pipelines }, lockedCompany] = await Promise.all([
    listPipelines(token),
    companyId ? getCompany(token, companyId) : Promise.resolve(null),
  ]);
  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  if (!pipeline) redirect("/dashboard/pipeline");

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);

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
        <div className="form-panel">
          <NovaForm
            pipelineId={pipeline.id}
            stages={stages}
            lockedCompanyId={lockedCompany?.id}
            lockedCompanyLabel={lockedCompany ? companyDisplayName(lockedCompany) : undefined}
          />
        </div>
      </div>
    </>
  );
}
