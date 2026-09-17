import NovaEmpresaFicha from "../_ficha/nova-ficha";

// Fallback full-page (acesso direto/refresh em /dashboard/empresas/nova).
// Em navegação normal dentro do app essa mesma rota é interceptada e
// aparece como drawer — ver web/app/dashboard/@drawer/(.)empresas/nova.
export default function NovaEmpresaPage() {
  return <NovaEmpresaFicha variant="page" />;
}
