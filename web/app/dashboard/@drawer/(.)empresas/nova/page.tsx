import NovaEmpresaFicha from "@/app/dashboard/empresas/_ficha/nova-ficha";

// Cadastro de empresa nova aparece como drawer (mesma moldura da ficha da
// empresa), não mais como modal de formulário — ver
// empresas/_ficha/nova-ficha.tsx. Rota estática, então tem prioridade
// sobre (.)empresas/[id] no mesmo slot.
export default function NovaEmpresaDrawer() {
  return <NovaEmpresaFicha variant="drawer" />;
}
