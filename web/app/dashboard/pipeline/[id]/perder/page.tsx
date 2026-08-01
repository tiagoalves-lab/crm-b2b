import { getServerAccessToken } from "@/lib/api/auth";
import { loadOpportunityDetail } from "../../_detail/load";
import LoseForm from "./lose-form";

export default async function MarcarPerdidaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getServerAccessToken();
  const data = await loadOpportunityDetail(token, id);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Marcar como perdida</div>
          <div className="page-sub">{data.company.name}</div>
        </div>
      </div>
      <div className="content">
        <div className="panel">
          <div className="panel-body">
            <LoseForm data={data} />
          </div>
        </div>
      </div>
    </>
  );
}
