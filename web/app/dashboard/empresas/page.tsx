import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, listCompanies } from "@/lib/api/companies";
import { getMe } from "@/lib/api/me";
import { listOpportunities } from "@/lib/api/opportunities";
import { listSalesHistory } from "@/lib/api/sales-history";
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
  const [{ items: allCompanies }, { items: opportunities }, salesHistory, me] = await Promise.all([
    listCompanies(token, showDeleted),
    listOpportunities(token),
    listSalesHistory(token),
    getMe(token),
  ]);
  // Representante não exclui nenhum tipo de registro (pedido do usuário,
  // 2026-08-06, ver PolicyService#can) — botão escondido aqui pra não
  // oferecer uma ação que o backend vai rejeitar de qualquer forma.
  const canDelete = me.membership.role !== "sales_rep";

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
  // "inativo" — gama-crm-mvp.html, DB.clientes). LTV/última compra somam
  // Opportunity "won" de verdade (pipeline novo, começou do zero) com
  // sales_history (histórico de vendas importado do eGestor, sem dono nem
  // ligação com Opportunity de propósito — ver migration
  // 20260801230000_sales_history).
  type CompanyStats = { status: "ativo" | "negociando"; ltv: number; ultimaCompra: string | null };
  const statsByCompany = new Map<string, CompanyStats>();
  for (const company of companies) {
    const won = opportunities.filter((o) => o.companyId === company.id && !o.deletedAt && o.status === "won");
    const sales = salesHistory.filter((s) => s.companyId === company.id);
    const ltv =
      won.reduce((s, o) => s + Number(o.amount), 0) + sales.reduce((s, v) => s + Number(v.valorTotal), 0);
    const datas = [
      ...won.map((o) => o.closedAt).filter((d): d is string => !!d),
      ...sales.map((s) => s.dtVenda),
    ];
    const ultimaCompra = datas.reduce<string | null>(
      (latest, d) => (!latest || d > latest ? d : latest),
      null,
    );
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
  // Ordem alfabética pela 1ª coluna (razão social — mesmo critério de
  // exibição do empresas-table.tsx).
  const rows: EmpresaRow[] = visible
    .map((company) => ({
      company,
      tipo: tipoOf(company),
      ...statsByCompany.get(company.id)!,
    }))
    .sort((a, b) =>
      (a.company.razaoSocial?.trim() || companyDisplayName(a.company)).localeCompare(
        b.company.razaoSocial?.trim() || companyDisplayName(b.company),
        "pt-BR",
      ),
    );

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
          canDelete={canDelete}
        />
      </div>
    </>
  );
}
