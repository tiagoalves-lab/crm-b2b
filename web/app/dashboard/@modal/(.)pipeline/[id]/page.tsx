import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { loadOpportunityDetail } from "@/app/dashboard/pipeline/_detail/load";
import { DetailBody, DetailFooter } from "@/app/dashboard/pipeline/_detail/detail-body";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function OpportunityDetailModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadOpportunityDetail(token, id);
  const backHref = `/dashboard/pipeline/${id}`;

  return (
    <OverlayModal title={companyDisplayName(data.company)} footer={<DetailFooter data={data} />} wide>
      <DetailBody data={data} backHref={backHref} />
    </OverlayModal>
  );
}
