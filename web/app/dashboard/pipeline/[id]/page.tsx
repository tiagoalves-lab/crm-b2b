import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { loadOpportunityDetail } from "../_detail/load";
import { DetailBody, DetailFooter } from "../_detail/detail-body";

// Fallback full-page (acesso direto/refresh no detalhe de uma
// oportunidade). Em navegação normal dentro do app, essa mesma rota é
// interceptada e abre como modal — ver @modal/(.)pipeline/[id].
export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadOpportunityDetail(token, id);
  const backHref = `/dashboard/pipeline/${id}`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">{companyDisplayName(data.company)}</div>
          <div className="page-sub">Oportunidade</div>
        </div>
      </div>
      <div className="content">
        <div className="panel">
          <div className="panel-body">
            <DetailBody data={data} backHref={backHref} />
          </div>
          <div className="modal-foot">
            <DetailFooter data={data} />
          </div>
        </div>
      </div>
    </>
  );
}
