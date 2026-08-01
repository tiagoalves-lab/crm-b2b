import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
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
              <th>Nome</th>
              <th>Tipo</th>
              <th>CPF/CNPJ</th>
              <th>Cidade/UF</th>
              <th>Tags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((company) => (
              <tr key={company.id} className="row-clickable">
                <td>
                  <Link href={`/dashboard/empresas/${company.id}`} className="t-co">
                    {company.name}
                  </Link>
                </td>
                <td>
                  <span className={tipoOf(company) === "cliente" ? "pill pill-green" : "pill pill-blue"}>
                    {tipoOf(company) === "cliente" ? "Cliente" : "Lead"}
                  </span>
                </td>
                <td className="t-sub">{company.cpfCnpj ?? "—"}</td>
                <td>
                  {company.cidade ? `${company.cidade}${company.uf ? `/${company.uf}` : ""}` : "—"}
                </td>
                <td className="t-sub">{company.tags.length > 0 ? company.tags.join(", ") : "—"}</td>
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
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
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
