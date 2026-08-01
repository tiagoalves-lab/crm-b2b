import { redirect } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { listPipelines } from "@/lib/api/pipelines";
import NovaForm from "./nova-form";

export default async function NovaOportunidadePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const { items: pipelines } = await listPipelines(token);
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
          <NovaForm pipelineId={pipeline.id} stages={stages} backHref="/dashboard/pipeline/nova" />
        </div>
      </div>
    </>
  );
}
