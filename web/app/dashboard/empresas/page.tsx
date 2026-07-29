import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { deleteCompanyAction, restoreCompanyAction } from "./actions";
import CompanyForm from "./company-form";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; includeDeleted?: string }>;
}) {
  const { error, includeDeleted } = await searchParams;
  const token = await getServerAccessToken();
  const showDeleted = includeDeleted === "1";
  const { items: companies } = await listCompanies(token, showDeleted);

  return (
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Empresas</h2>
          <p className="sub">
            {companies.length} empresa(s){showDeleted ? " (incluindo excluídas)" : ""}
          </p>
        </div>
        <Link
          href={showDeleted ? "/dashboard/empresas" : "/dashboard/empresas?includeDeleted=1"}
          className="btn btn-ghost btn-sm"
        >
          {showDeleted ? "Ocultar excluídas" : "Ver excluídas"}
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <CompanyForm />

      <table className="data-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Razão social</th>
            <th>CPF/CNPJ</th>
            <th>Cidade/UF</th>
            <th>Tags</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id}>
              <td>{company.name}</td>
              <td>{company.razaoSocial ?? "—"}</td>
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
          {companies.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                Nenhuma empresa ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
