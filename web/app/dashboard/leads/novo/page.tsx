import Link from "next/link";
import LeadForm from "../lead-form";

// Fallback full-page (acesso direto/refresh em /dashboard/leads/novo). Em
// navegação normal dentro do app essa mesma rota é interceptada e aparece
// como modal — ver web/app/dashboard/@modal/(.)leads/novo.
export default function NovoLeadPage() {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Nova empresa</div>
          <div className="page-sub">Adicionar à triagem</div>
        </div>
        <Link href="/dashboard/leads" className="btn btn-ghost btn-sm">
          ✕ Cancelar
        </Link>
      </div>
      <div className="content">
        <div className="form-panel">
          <LeadForm />
        </div>
      </div>
    </>
  );
}
