import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { listPipelines } from "@/lib/api/pipelines";
import NovaForm from "@/app/dashboard/pipeline/nova/nova-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function NovaOportunidadeModal({
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
      <NovaForm
        pipelineId={pipeline.id}
        stages={stages}
        lockedCompanyId={lockedCompany?.id}
        lockedCompanyLabel={lockedCompany ? companyDisplayName(lockedCompany) : undefined}
      />
    </OverlayModal>
  );
}
