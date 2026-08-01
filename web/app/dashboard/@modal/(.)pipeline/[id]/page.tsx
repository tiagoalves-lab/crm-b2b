import { getServerAccessToken } from "@/lib/api/auth";
import { loadOpportunityDetail } from "@/app/dashboard/pipeline/_detail/load";
import { DetailFooter, DetailKv } from "@/app/dashboard/pipeline/_detail/detail-body";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function OpportunityDetailModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadOpportunityDetail(token, id);

  return (
    <OverlayModal title={data.company.name} footer={<DetailFooter data={data} />}>
      <DetailKv data={data} />
    </OverlayModal>
  );
}
