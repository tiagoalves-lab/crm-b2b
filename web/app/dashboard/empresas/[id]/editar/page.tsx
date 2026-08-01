import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getCompany } from "@/lib/api/companies";
import CompanyForm from "../../company-form";

// Fallback full-page — em navegação normal a mesma rota é interceptada
// como modal (@modal/(.)empresas/[id]/editar).
export default async function EditarEmpresaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const company = await getCompany(token, id);
  const back = `/dashboard/empresas/${id}`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Editar {company.name}</div>
          <div className="page-sub">Dados básicos do cadastro</div>
        </div>
        <Link href={back} className="btn btn-ghost btn-sm">
          ✕ Cancelar
        </Link>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <CompanyForm company={company} backHref={back} />
        </div>
      </div>
    </>
  );
}
