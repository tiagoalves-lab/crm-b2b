import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";
import { loadFicha } from "../_ficha/load";
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
  searchParams: Promise<{ aba?: string; error?: string }>;
}) {
  const { id } = await params;
  const { aba, error } = await searchParams;
  const token = await getServerAccessToken();
  const data = await loadFicha(token, id);
  const { company, activities, tasks, opportunities } = data;
  // Mesmo critério da lista (web/app/dashboard/empresas/page.tsx#tipoOf):
  // tag "cliente" (dado real da importação), não presença de Opportunity
  // "won" — pipeline novo começou do zero, sem negócio pros clientes já
  // existentes antes dele.
  const isCliente = company.tags.includes("cliente");
  const currentAba = currentAbaOf(aba);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">{companyDisplayName(company)}</div>
          <div className="page-sub">
            {company.cpfCnpj ?? "sem CPF/CNPJ"}
            {company.cidade ? ` · ${company.cidade}${company.uf ? `/${company.uf}` : ""}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={isCliente ? "pill pill-green" : "pill pill-blue"}>
            {isCliente ? "Cliente" : "Lead"}
          </span>
          <Link href={`/dashboard/empresas/${id}/editar`} className="btn btn-sm">
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
          counts={{ timeline: activities.length, tarefas: tasks.length, negocios: opportunities.length }}
        />
      </div>

      <div className="content" key={currentAba}>
        {error && <div className="error-banner">{error}</div>}
        <FichaBody data={data} aba={aba} />
      </div>
    </>
  );
}
