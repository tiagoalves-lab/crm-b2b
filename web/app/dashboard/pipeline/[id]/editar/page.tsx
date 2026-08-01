import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { loadOpportunityDetail } from "../../_detail/load";
import { updateOpportunityDetailsAction } from "../../actions";
import EditForm from "./edit-form";

export default async function EditarOportunidadePage({
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
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Editar oportunidade</div>
          <div className="page-sub">{companyDisplayName(data.company)}</div>
        </div>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <EditForm data={data} action={updateOpportunityDetailsAction} backHref={`/dashboard/pipeline/${id}/editar`} />
        </div>
      </div>
    </>
  );
}
