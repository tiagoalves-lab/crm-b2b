import { getServerAccessToken } from "@/lib/api/auth";
import { resolveAssigneeOptions } from "@/lib/api/assignee-options";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { listPipelines } from "@/lib/api/pipelines";
import NovaCard from "@/app/dashboard/pipeline/nova/nova-card";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

// Cadastro de oportunidade no mesmo card do detalhe (2026-09-04) — ver
// pipeline/nova/nova-card.tsx. O rodapé (Fechar / Criar oportunidade)
// mora dentro do card, porque o botão de enviar precisa estar dentro do
// <form>.
export default async function NovaOportunidadeModal({
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

  if (!pipeline) {
    return (
      <OverlayModal title="Nova oportunidade">
        <p className="sub">Nenhum pipeline configurado ainda — crie um em /dashboard/pipeline primeiro.</p>
      </OverlayModal>
    );
  }

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const initialContacts = lockedCompany ? await listContacts(token, lockedCompany.id) : [];

  return (
    <OverlayModal title="Nova oportunidade" wide xl>
      {error && <div className="error-banner">{error}</div>}
      <NovaCard
        pipelineId={pipeline.id}
        stages={stages}
        lockedCompanyId={lockedCompany?.id}
        lockedCompanyLabel={lockedCompany ? companyDisplayName(lockedCompany) : undefined}
        frame="modal"
        assigneeOptions={assigneeOptions}
        initialContacts={initialContacts}
      />
    </OverlayModal>
  );
}
