import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listCompanies } from "@/lib/api/companies";
import { listContacts } from "@/lib/api/contacts";
import { createContactAction, deleteContactAction, restoreContactAction } from "./actions";

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; includeDeleted?: string }>;
}) {
  const { error, includeDeleted } = await searchParams;
  const token = await getServerAccessToken();
  const showDeleted = includeDeleted === "1";
  const [{ items: contacts }, { items: companies }] = await Promise.all([
    listContacts(token, showDeleted),
    listCompanies(token),
  ]);
  const companyName = (companyId: string | null) =>
    companies.find((c) => c.id === companyId)?.name ?? "—";

  return (
    <div className="content-wide">
      <div className="toolbar">
        <div className="panel-head">
          <h2>Contatos</h2>
          <p className="sub">
            {contacts.length} contato(s){showDeleted ? " (incluindo excluídos)" : ""}
          </p>
        </div>
        <Link
          href={showDeleted ? "/dashboard/contatos" : "/dashboard/contatos?includeDeleted=1"}
          className="btn btn-ghost btn-sm"
        >
          {showDeleted ? "Ocultar excluídos" : "Ver excluídos"}
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-panel">
        <form action={createContactAction} className="form-grid">
          <label>
            Nome*
            <input name="name" required />
          </label>
          <label>
            Empresa
            <select name="companyId" defaultValue="">
              <option value="">— nenhuma —</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            E-mail
            <input name="email" type="email" />
          </label>
          <label>
            Telefone
            <input name="phone" />
          </label>
          <label>
            Cargo
            <input name="title" />
          </label>
          <button type="submit" className="btn btn-primary">
            Novo contato
          </button>
        </form>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Empresa</th>
            <th>E-mail</th>
            <th>Telefone</th>
            <th>Cargo</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => (
            <tr key={contact.id}>
              <td>{contact.name}</td>
              <td>{companyName(contact.companyId)}</td>
              <td>{contact.email ?? "—"}</td>
              <td>{contact.phone ?? "—"}</td>
              <td>{contact.title ?? "—"}</td>
              <td>
                {contact.deletedAt ? (
                  <form action={restoreContactAction}>
                    <input type="hidden" name="id" value={contact.id} />
                    <button type="submit" className="btn btn-sm">
                      Restaurar
                    </button>
                  </form>
                ) : (
                  <form action={deleteContactAction}>
                    <input type="hidden" name="id" value={contact.id} />
                    <button type="submit" className="btn btn-danger btn-sm">
                      Excluir
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {contacts.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                Nenhum contato ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
