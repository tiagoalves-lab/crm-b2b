import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, getCompany } from "@/lib/api/companies";
import CompanyForm from "@/app/dashboard/empresas/company-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function EditarEmpresaModal({
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

  return (
    <OverlayModal title={`Editar ${companyDisplayName(company)}`} wide>
      {error && <div className="error-banner">{error}</div>}
      <CompanyForm company={company} backHref={`/dashboard/empresas/${id}`} />
    </OverlayModal>
  );
}
