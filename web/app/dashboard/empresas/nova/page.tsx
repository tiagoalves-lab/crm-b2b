import Link from "next/link";
import CompanyForm from "../company-form";

// Fallback full-page (acesso direto/refresh em /dashboard/empresas/nova).
// Em navegação normal dentro do app, essa mesma rota é interceptada e
// aparece como modal — ver web/app/dashboard/@modal/(.)empresas/nova.
export default async function NovaEmpresaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Nova empresa</div>
          <div className="page-sub">Cadastro completo</div>
        </div>
        <Link href="/dashboard/empresas" className="btn btn-ghost btn-sm">
          ✕ Cancelar
        </Link>
      </div>
      <div className="content">
        {error && <div className="error-banner">{error}</div>}
        <div className="form-panel">
          <CompanyForm />
        </div>
      </div>
    </>
  );
}
