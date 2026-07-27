import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { createCompanyAction, deleteCompanyAction, restoreCompanyAction } from "./actions";

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

      <div className="form-panel">
        <form action={createCompanyAction} className="form-grid">
          <label>
            Nome*
            <input name="name" required />
          </label>
          <label>
            Domínio
            <input name="domain" placeholder="empresa.com.br" />
          </label>
          <label>
            Setor
            <input name="industry" />
          </label>
          <label>
            Porte
            <input name="size" />
          </label>
          <button type="submit" className="btn btn-primary">
            Nova empresa
          </button>
        </form>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Domínio</th>
            <th>Setor</th>
            <th>Porte</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id}>
              <td>{company.name}</td>
              <td>{company.domain ?? "—"}</td>
              <td>{company.industry ?? "—"}</td>
              <td>{company.size ?? "—"}</td>
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
              <td colSpan={5} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                Nenhuma empresa ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
