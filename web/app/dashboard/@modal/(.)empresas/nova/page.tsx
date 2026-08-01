import CompanyForm from "@/app/dashboard/empresas/company-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default async function NovaEmpresaModal({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <OverlayModal title="Nova empresa" wide>
      {error && <div className="error-banner">{error}</div>}
      <CompanyForm />
    </OverlayModal>
  );
}
