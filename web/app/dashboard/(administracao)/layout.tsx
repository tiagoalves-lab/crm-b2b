import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import AdminTabs from "./admin-tabs";

// Grupo de rotas "(administracao)" (2026-09-17): os parênteses não entram
// na URL — /dashboard/membros continua /dashboard/membros. Serve só pra
// todas as telas administrativas dividirem este cabeçalho de abas.
export default async function AdministracaoLayout({ children }: { children: React.ReactNode }) {
  const token = await getServerAccessToken();
  // getMe tem cache() por renderização — o layout do dashboard já buscou.
  const me = await getMe(token);

  return (
    <>
      <AdminTabs role={me.membership.role} />
      {children}
    </>
  );
}
