import { getServerAccessToken } from "@/lib/api/auth";
import { loadOpportunityDetail } from "@/app/dashboard/pipeline/_detail/load";
import LoseForm from "@/app/dashboard/pipeline/[id]/perder/lose-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function MarcarPerdidaModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadOpportunityDetail(token, id);

  return (
    <OverlayModal title="Marcar como perdida">
      <LoseForm data={data} />
    </OverlayModal>
  );
}
