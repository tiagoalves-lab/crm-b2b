import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { listOpportunities } from "@/lib/api/opportunities";
import type { Company } from "@/lib/api/types";
import { deleteCompanyAction, restoreCompanyAction } from "./actions";
import CompanyForm from "./company-form";
import CompanyFicha from "./company-ficha";

type Filtro = "todas" | "lead" | "cliente";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    includeDeleted?: string;
    empresa?: string;
    aba?: string;
    filtro?: string;
  }>;
}) {
  const { error, includeDeleted, empresa, aba, filtro } = await searchParams;
  const token = await getServerAccessToken();

  if (empresa) {
    return <CompanyFicha token={token} companyId={empresa} aba={aba} error={error} />;
  }

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
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Empresas</h2>
          <p className="sub">
            {visible.length} de {companies.length} empresa(s)
            {showDeleted ? " (incluindo excluídas)" : ""}
          </p>
        </div>
        <Link href={deletedHref} className="btn btn-ghost btn-sm">
          {showDeleted ? "Ocultar excluídas" : "Ver excluídas"}
        </Link>
      </div>

      <div className="view-tabs" style={{ marginBottom: 16 }}>
        <Link href={filtroHref("todas")} className={currentFiltro === "todas" ? "view-tab active" : "view-tab"}>
          Todas ({companies.length})
        </Link>
        <Link href={filtroHref("lead")} className={currentFiltro === "lead" ? "view-tab active" : "view-tab"}>
          Leads ({leadsCount})
        </Link>
        <Link href={filtroHref("cliente")} className={currentFiltro === "cliente" ? "view-tab active" : "view-tab"}>
          Clientes ({clientesCount})
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <CompanyForm />

      <table className="data-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>CPF/CNPJ</th>
            <th>Cidade/UF</th>
            <th>Tags</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((company) => (
            <tr key={company.id}>
              <td>
                <Link href={`/dashboard/empresas?empresa=${company.id}`}>{company.name}</Link>
              </td>
              <td>
                <span className={tipoOf(company) === "cliente" ? "badge badge-accent" : "badge"}>
                  {tipoOf(company)}
                </span>
              </td>
              <td>{company.cpfCnpj ?? "—"}</td>
              <td>
                {company.cidade ? `${company.cidade}${company.uf ? `/${company.uf}` : ""}` : "—"}
              </td>
              <td>{company.tags.length > 0 ? company.tags.join(", ") : "—"}</td>
              <td>
                {company.deletedAt ? (
                  <form action={restoreCompanyAction}>
                    <input type="hidden" name="id" value={company.id} />
                    <button type="submit" className="btn btn-sm">
                      Restaurar
                    </button>
                  </form>
                ) : (
                  <form action={deleteCompanyAction}>
                    <input type="hidden" name="id" value={company.id} />
                    <button type="submit" className="btn btn-danger btn-sm">
                      Excluir
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                Nenhuma empresa encontrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
