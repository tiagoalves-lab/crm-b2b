import NovaLeadFicha from "../_ficha/nova-ficha";

// Fallback full-page (acesso direto/refresh em /dashboard/leads/novo). Em
// navegação normal dentro do app essa mesma rota é interceptada e aparece
// como drawer — ver web/app/dashboard/@drawer/(.)leads/novo.
export default function NovoLeadPage() {
  return <NovaLeadFicha variant="page" />;
}
