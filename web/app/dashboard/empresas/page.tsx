import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import type { Company } from "@/lib/api/types";
import EmpresasTable, { type EmpresaRow } from "./empresas-table";

type Filtro = "todas" | "lead" | "cliente";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    includeDeleted?: string;
    filtro?: string;
  }>;
}) {
  const { error, includeDeleted, filtro } = await searchParams;
  const token = await getServerAccessToken();

  const showDeleted = includeDeleted === "1";
  const [{ items: allCompanies }, { items: opportunities }] = await Promise.all([
    listCompanies(token, showDeleted),
    listOpportunities(token),
  ]);

  // Company-lead ainda em triagem (SPEC-CRM-GAMA.md §4.4) não é uma
  // empresa de verdade até ser aprovada — fica de fora daqui, mesmo
  // critério de exclusão da view v_busca_empresa_lead. Ela aparece na
  // tela Leads em vez desta.
  const companies = allCompanies.filter((c) => !c.tags.includes("lead-triagem"));

  // Selo lead/cliente: a tag "cliente" já vem da importação real (291 das
  // 292 empresas do banco de produção têm essa tag) — usar "existe
  // opportunity won" aqui (alternativa que o SPEC-CRM-GAMA.md §4.1 também
  // previa) deixava tudo "lead" porque o pipeline deste CRM começou do
  // zero, sem oportunidade nenhuma pros clientes já existentes antes dele.
  const tipoOf = (c: Company): "lead" | "cliente" =>
    c.tags.includes("cliente") ? "cliente" : "lead";

  // Status espelha o Tipo (protótipo só usa "ativo"/"negociando", nunca
  // "inativo" — gama-crm-mvp.html, DB.clientes). LTV/última compra continuam
  // vindo de Opportunity "won" de verdade, sem relação com o Tipo/Status.
  type CompanyStats = { status: "ativo" | "negociando"; ltv: number; ultimaCompra: string | null };
  const statsByCompany = new Map<string, CompanyStats>();
  for (const company of companies) {
    const won = opportunities.filter((o) => o.companyId === company.id && !o.deletedAt && o.status === "won");
    const ltv = won.reduce((s, o) => s + Number(o.amount), 0);
    const ultimaCompra = won.reduce<string | null>((latest, o) => {
      if (!o.closedAt) return latest;
      return !latest || o.closedAt > latest ? o.closedAt : latest;
    }, null);
    statsByCompany.set(company.id, {
      status: tipoOf(company) === "cliente" ? "ativo" : "negociando",
      ltv,
      ultimaCompra,
    });
  }

  const currentFiltro: Filtro = filtro === "lead" || filtro === "cliente" ? filtro : "todas";
  const leadsCount = companies.filter((c) => tipoOf(c) === "lead").length;
  const clientesCount = companies.filter((c) => tipoOf(c) === "cliente").length;
  const visible = companies.filter(
    (c) => currentFiltro === "todas" || tipoOf(c) === currentFiltro,
  );
  const rows: EmpresaRow[] = visible.map((company) => ({
    company,
    tipo: tipoOf(company),
    ...statsByCompany.get(company.id)!,
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Empresas</div>
          <div className="page-sub">
            {visible.length} de {companies.length} empresa(s)
            {showDeleted ? " (incluindo excluídas)" : ""}
          </div>
        </div>
        <Link href="/dashboard/empresas/nova" className="btn btn-primary">
          + Nova empresa
        </Link>
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

        <EmpresasTable
          rows={rows}
          currentFiltro={currentFiltro}
          showDeleted={showDeleted}
          counts={{ todas: companies.length, lead: leadsCount, cliente: clientesCount }}
        />
      </div>
    </>
  );
}
