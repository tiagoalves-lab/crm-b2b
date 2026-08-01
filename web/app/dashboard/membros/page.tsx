import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import type { Membership } from "@/lib/api/types";
import { ROLE_LABELS, ROLE_PILL, memberLogin, memberName } from "./roles";

export default async function MembrosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const token = await getServerAccessToken();
  const [me, members] = await Promise.all([
    getMe(token),
    listMemberships(token),
  ]);
  const canManage = me.membership.role === "owner" || me.membership.role === "admin";

  const managerName = (managerId: string | null) => {
    if (!managerId) return "—";
    const manager = members.find((m: Membership) => m.id === managerId);
    return manager ? memberName(manager) : "—";
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Membros do workspace</div>
          <div className="page-sub">
            {members.length} membro(s) — representante gerencia o próprio,
            gerente vê o próprio + o dos subordinados (definido aqui)
          </div>
        </div>
        {canManage && (
          <Link href="/dashboard/membros/novo" className="btn btn-primary">
            + Novo membro
          </Link>
        )}
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

        <table className="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Login</th>
              <th>Papel</th>
              <th>Gerente</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="t-co">
                    {memberName(member)}
                    {member.userId === me.user.id ? " (você)" : ""}
                  </span>
                </td>
                <td className="t-sub">{memberLogin(member)}</td>
                <td>
                  <span className={ROLE_PILL[member.role]}>{ROLE_LABELS[member.role]}</span>
                </td>
                <td>{managerName(member.managerId)}</td>
                {canManage && (
                  <td>
                    <div className="cell-actions">
                      <Link
                        href={`/dashboard/membros/${member.id}/editar`}
                        className="icon-btn"
                        title="Editar"
                      >
                        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </Link>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="empty">
                  Nenhum membro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
