import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyRazaoSocialName, ehClienteDaCarteira } from "@/lib/api/companies";
import { hasPermission } from "@/lib/api/permission-catalog";
import { contagensDaFicha, loadFicha } from "../_ficha/load";
import FichaTabs, { currentAbaOf } from "../_ficha/ficha-tabs";
import FichaBody from "../_ficha/ficha-body";

// Fallback full-page (acesso direto/refresh na ficha de uma empresa). Em
// navegação normal dentro do app, essa mesma rota é interceptada e abre
// como drawer lateral — ver web/app/dashboard/@drawer/(.)empresas/[id].
export default async function EmpresaFichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; error?: string; editar?: string }>;
}) {
  const { id } = await params;
  const { aba, error, editar } = await searchParams;
  const token = await getServerAccessToken();
  const data = await loadFicha(token, id);
  const { company, me } = data;
  const podeVerVendas = hasPermission(
    me.membership.role,
    me.membership.permissions,
    "empresas_vendas",
    "ver",
  );
  // Mesma régua da lista e da busca geral, calculada no backend
  // (src/companies/cliente-regra.ts): cliente é quem já comprou — pedido
  // emitido no eGestor ou oportunidade ganha no CRM.
  const isCliente = ehClienteDaCarteira(company);
  const currentAba = currentAbaOf(aba, { podeVerVendas, isCliente });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">{companyRazaoSocialName(company)}</div>
          <div className="page-sub">
            {company.cpfCnpj ?? "sem CPF/CNPJ"}
            {company.cidade ? ` · ${company.cidade}${company.uf ? `/${company.uf}` : ""}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={isCliente ? "pill pill-green" : "pill pill-blue"}>
            {isCliente ? "Cliente" : "Lead"}
          </span>
          <Link href={`/dashboard/empresas/${id}?aba=cadastro&editar=1`} replace scroll={false} className="btn btn-sm">
            Editar
          </Link>
          <Link href="/dashboard/empresas" className="btn btn-ghost btn-sm">
            ✕ Fechar
          </Link>
        </div>
      </div>

      <div className="drawer-tabs" style={{ padding: "0 28px" }}>
        <FichaTabs
          companyId={id}
          aba={aba}
          counts={contagensDaFicha(data)}
          podeVerVendas={podeVerVendas}
          isCliente={isCliente}
        />
      </div>

      <div className="content" key={currentAba}>
        {error && <div className="error-banner">{error}</div>}
        <FichaBody data={data} aba={aba} editar={editar === "1"} />
      </div>
    </>
  );
}
