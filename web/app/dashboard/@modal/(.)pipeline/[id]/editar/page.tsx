import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { loadOpportunityDetail } from "@/app/dashboard/pipeline/_detail/load";
import { updateOpportunityDetailsAction } from "@/app/dashboard/pipeline/actions";
import EditForm from "@/app/dashboard/pipeline/[id]/editar/edit-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function EditarOportunidadeModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const data = await loadOpportunityDetail(token, id);

  return (
    <OverlayModal title={`Editar oportunidade — ${companyDisplayName(data.company)}`}>
      {error && <div className="error-banner">{error}</div>}
      <EditForm data={data} action={updateOpportunityDetailsAction} backHref={`/dashboard/pipeline/${id}/editar`} />
    </OverlayModal>
  );
}
