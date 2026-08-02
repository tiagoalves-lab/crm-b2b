import { getServerAccessToken } from "@/lib/api/auth";
import { listPipelines } from "@/lib/api/pipelines";
import NovaForm from "@/app/dashboard/pipeline/nova/nova-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function NovaOportunidadeModal({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const { items: pipelines } = await listPipelines(token);
  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  if (!pipeline) {
    return (
      <OverlayModal title="Nova oportunidade">
        <p className="sub">Nenhum pipeline configurado ainda — crie um em /dashboard/pipeline primeiro.</p>
      </OverlayModal>
    );
  }

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);

  return (
    <OverlayModal title="Nova oportunidade" wide>
      {error && <div className="error-banner">{error}</div>}
      <NovaForm pipelineId={pipeline.id} stages={stages} />
    </OverlayModal>
  );
}
