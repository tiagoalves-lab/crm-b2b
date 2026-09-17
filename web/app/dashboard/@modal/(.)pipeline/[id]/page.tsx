import { getServerAccessToken } from "@/lib/api/auth";
import { companyRazaoSocialName } from "@/lib/api/companies";
import { loadOpportunityDetail } from "@/app/dashboard/pipeline/_detail/load";
import { DetailBody, OpportunityDetailProvider } from "@/app/dashboard/pipeline/_detail/opportunity-detail";
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
    <OpportunityDetailProvider data={data} isModal>
      <OverlayModal title={companyRazaoSocialName(data.company)} wide xl>
        <DetailBody />
      </OverlayModal>
    </OpportunityDetailProvider>
  );
}
