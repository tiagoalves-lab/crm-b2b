import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { companyDisplayName, listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import type { Company } from "@/lib/api/types";
import { deleteCompanyAction, restoreCompanyAction } from "./actions";

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

  // Selo lead/cliente: cliente se existe ao menos uma opportunity "won"
  // vinculada; senão lead (SPEC-CRM-GAMA.md §4.1).
  const wonCompanyIds = new Set(
    opportunities.filter((o) => o.status === "won" && !o.deletedAt).map((o) => o.companyId),
  );
  const tipoOf = (c: Company): "lead" | "cliente" =>
    wonCompanyIds.has(c.id) ? "cliente" : "lead";

  // Colunas Status/LTV/Última compra do protótipo (gama-crm-mvp.html,
  // clienteRows()) eram dado fictício solto na linha; aqui derivamos de
  // Opportunity de verdade — status: tem oportunidade aberta = "negociando"
  // (mais acionável), senão tem alguma ganha = "ativo", senão "inativo".
  type CompanyStats = { status: "ativo" | "negociando" | "inativo"; ltv: number; ultimaCompra: string | null };
  const statsByCompany = new Map<string, CompanyStats>();
  for (const company of companies) {
    const own = opportunities.filter((o) => o.companyId === company.id && !o.deletedAt);
    const won = own.filter((o) => o.status === "won");
    const hasOpen = own.some((o) => o.status === "open");
    const ltv = won.reduce((s, o) => s + Number(o.amount), 0);
    const ultimaCompra = won.reduce<string | null>((latest, o) => {
      if (!o.closedAt) return latest;
      return !latest || o.closedAt > latest ? o.closedAt : latest;
    }, null);
    statsByCompany.set(company.id, {
      status: hasOpen ? "negociando" : won.length > 0 ? "ativo" : "inativo",
      ltv,
      ultimaCompra,
    });
  }
  const STATUS_LABEL: Record<CompanyStats["status"], string> = {
    ativo: "ativo",
    negociando: "negociando",
    inativo: "inativo",
  };
  const STATUS_PILL: Record<CompanyStats["status"], string> = {
    ativo: "pill pill-green",
    negociando: "pill pill-amber",
    inativo: "pill pill-gray",
  };
  const brl = (value: number) => `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  const currentFiltro: Filtro = filtro === "lead" || filtro === "cliente" ? filtro : "todas";
  const leadsCount = companies.filter((c) => tipoOf(c) === "lead").length;
  const clientesCount = companies.filter((c) => tipoOf(c) === "cliente").length;
  const visible = companies.filter(
    (c) => currentFiltro === "todas" || tipoOf(c) === currentFiltro,
  );

  const filtroHref = (f: Filtro) =>
    `/dashboard/empresas?filtro=${f}${showDeleted ? "&includeDeleted=1" : ""}`;
  const deletedHref = showDeleted
    ? `/dashboard/empresas?filtro=${currentFiltro}`
    : `/dashboard/empresas?filtro=${currentFiltro}&includeDeleted=1`;

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
        <div className="toolbar">
          <div className="seg">
            <Link href={filtroHref("todas")} className={currentFiltro === "todas" ? "active" : undefined}>
              Todas ({companies.length})
            </Link>
            <Link href={filtroHref("lead")} className={currentFiltro === "lead" ? "active" : undefined}>
              Leads ({leadsCount})
            </Link>
            <Link href={filtroHref("cliente")} className={currentFiltro === "cliente" ? "active" : undefined}>
              Clientes ({clientesCount})
            </Link>
          </div>
          <Link href={deletedHref} className="btn btn-ghost btn-sm">
            {showDeleted ? "Ocultar excluídas" : "Ver excluídas"}
          </Link>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Tipo</th>
              <th>Contato</th>
              <th>Cidade</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>LTV</th>
              <th>Última compra</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((company) => {
              const stats = statsByCompany.get(company.id)!;
              return (
              <tr key={company.id} className="row-clickable">
                <td>
                  <Link href={`/dashboard/empresas/${company.id}`} className="t-co">
                    {companyDisplayName(company)}
                  </Link>
                  <div className="t-sub">{company.cpfCnpj ?? "sem CPF/CNPJ"}</div>
                </td>
                <td>
                  <span className={tipoOf(company) === "cliente" ? "pill pill-green" : "pill pill-blue"}>
                    {tipoOf(company) === "cliente" ? "Cliente" : "Lead"}
                  </span>
                </td>
                <td>
                  {company.nomeParaContato ?? "—"}
                  <div className="t-sub">{company.fones[0] ?? ""}</div>
                </td>
                <td>
                  {company.cidade ? `${company.cidade}${company.uf ? `/${company.uf}` : ""}` : "—"}
                </td>
                <td>
                  <span className={STATUS_PILL[stats.status]}>{STATUS_LABEL[stats.status]}</span>
                </td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: stats.ltv > 0 ? "var(--green)" : "var(--text-tertiary)" }}>
                  {stats.ltv > 0 ? brl(stats.ltv) : "—"}
                </td>
                <td className="t-sub">{stats.ultimaCompra ? new Date(stats.ultimaCompra).toLocaleDateString("pt-BR") : "—"}</td>
                <td>
                  <div className="cell-actions">
                    <Link href={`/dashboard/empresas/${company.id}`} className="icon-btn" title="Abrir ficha">
                      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </Link>
                    <Link href={`/dashboard/empresas/${company.id}/editar`} className="icon-btn" title="Editar">
                      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </Link>
                    {company.deletedAt ? (
                      <form action={restoreCompanyAction}>
                        <input type="hidden" name="id" value={company.id} />
                        <button type="submit" className="icon-btn" title="Restaurar">
                          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                        </button>
                      </form>
                    ) : (
                      <form action={deleteCompanyAction}>
                        <input type="hidden" name="id" value={company.id} />
                        <button type="submit" className="icon-btn danger" title="Excluir">
                          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                          </svg>
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  Nenhuma empresa encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
