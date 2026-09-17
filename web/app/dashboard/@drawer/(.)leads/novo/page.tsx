import NovaLeadFicha from "@/app/dashboard/leads/_ficha/nova-ficha";

// Cadastro de empresa nova aparece como drawer (mesma moldura da ficha do
// lead), não mais como modal de formulário — ver leads/_ficha/nova-ficha.tsx.
// Rota estática, então tem prioridade sobre (.)leads/[id] no mesmo slot.
export default function NovoLeadDrawer() {
  return <NovaLeadFicha variant="drawer" />;
}
