import { getServerAccessToken } from "@/lib/api/auth";
import { scoreTier } from "@/lib/api/raw-leads";
import { loadLeadFicha } from "@/app/dashboard/leads/_ficha/load";
import FichaTabs from "@/app/dashboard/leads/_ficha/ficha-tabs";
import FichaBody from "@/app/dashboard/leads/_ficha/ficha-body";
import OverlayDrawer from "@/app/dashboard/_overlay/overlay-drawer";

export default async function LeadFichaDrawer({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; error?: string }>;
}) {
  const { id } = await params;
  const { aba, error } = await searchParams;
  const token = await getServerAccessToken();
  const data = await loadLeadFicha(token, id);
  const { lead, activities, tasks } = data;
  const tier = scoreTier(lead.score);

  return (
    <OverlayDrawer
      head={
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="drawer-co-name">{lead.razaoSocial}</div>
          <div className="drawer-co-meta">
            {lead.cnpj ?? "sem CNPJ"}
            {lead.municipio ? ` · ${lead.municipio}${lead.uf ? `/${lead.uf}` : ""}` : ""}
          </div>
          <div className="row-form" style={{ marginTop: 10 }}>
            <span className="pill pill-blue">lead · triagem</span>
            <span className={`tier-tag tier-${tier}`} style={{ fontSize: 11 }}>
              score {lead.score}
            </span>
            {lead.status !== "novo" && <span className="pill pill-gray">{lead.status}</span>}
          </div>
        </div>
      }
      tabs={<FichaTabs leadId={id} aba={aba} counts={{ timeline: activities.length, tarefas: tasks.length }} />}
    >
      {error && <div className="error-banner">{error}</div>}
      <FichaBody data={data} aba={aba} />
    </OverlayDrawer>
  );
}
