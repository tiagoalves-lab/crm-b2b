import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { effectiveTier } from "@/lib/api/raw-leads";
import { loadLeadFicha } from "../_ficha/load";
import FichaTabs from "../_ficha/ficha-tabs";
import FichaBody from "../_ficha/ficha-body";
import { discardOneLeadAction } from "../actions";
import ApproveLeadButton from "../approve-button";
import SubmitButton from "@/app/_components/submit-button";

// Fallback full-page — em navegação normal a mesma rota é interceptada
// como drawer (ver @drawer/(.)leads/[id]).
export default async function LeadFichaPage({
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
  const { lead, activities, tasks, contacts } = data;
  const tier = effectiveTier(lead);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">{lead.razaoSocial}</div>
          <div className="page-sub">
            {lead.cnpj ?? "sem CNPJ"}
            {lead.municipio ? ` · ${lead.municipio}${lead.uf ? `/${lead.uf}` : ""}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={`tier-tag tier-${tier}`}>score {lead.score}</span>
          {lead.status !== "novo" && <span className="pill pill-gray">{lead.status}</span>}
          {lead.status === "novo" && (
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <form action={discardOneLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="back" value="/dashboard/leads" />
                <SubmitButton className="btn btn-danger btn-sm" style={{ width: 150, justifyContent: "center" }} pendingLabel="Descartando…">
                  Descartar
                </SubmitButton>
              </form>
              <ApproveLeadButton leadId={lead.id} />
            </div>
          )}
          <Link href="/dashboard/leads" className="btn btn-ghost btn-sm">
            ✕ Fechar
          </Link>
        </div>
      </div>

      <div className="drawer-tabs" style={{ padding: "0 28px" }}>
        <FichaTabs
          leadId={id}
          aba={aba}
          counts={{ timeline: activities.length, tarefas: tasks.length, contatos: contacts.length }}
        />
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <FichaBody data={data} aba={aba} />
      </div>
    </>
  );
}
