import Link from "next/link";
import { loadFicha } from "@/app/dashboard/empresas/_ficha/load";
import FichaTabs from "@/app/dashboard/empresas/_ficha/ficha-tabs";
import FichaBody from "@/app/dashboard/empresas/_ficha/ficha-body";
import OverlayDrawer from "@/app/dashboard/_overlay/overlay-drawer";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName } from "@/lib/api/companies";

export default async function EmpresaFichaDrawer({
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
  const isCliente = opportunities.some((o) => o.status === "won" && !o.deletedAt);

  return (
    <OverlayDrawer
      head={
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div className="drawer-co-name">{companyDisplayName(company)}</div>
            <div className="drawer-co-meta">
              {company.cpfCnpj ?? "sem CPF/CNPJ"}
              {company.cidade ? ` · ${company.cidade}${company.uf ? `/${company.uf}` : ""}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={isCliente ? "pill pill-green" : "pill pill-blue"}>
              {isCliente ? "Cliente" : "Lead"}
            </span>
            <Link href={`/dashboard/empresas/${id}/editar`} className="btn btn-sm">
              Editar
            </Link>
          </div>
        </div>
      }
      tabs={
        <FichaTabs
          companyId={id}
          aba={aba}
          counts={{ timeline: activities.length, tarefas: tasks.length, negocios: opportunities.length }}
        />
      }
    >
      {error && <div className="error-banner">{error}</div>}
      <FichaBody data={data} aba={aba} />
    </OverlayDrawer>
  );
}
