import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import type { Membership } from "@/lib/api/types";
import { removeMemberAction } from "./actions";
import ConfirmSubmitButton from "./confirm-submit-button";
import { ROLE_LABELS, ROLE_PILL, memberEmail, memberLogin, memberName } from "./roles";
import TopbarFilter from "@/app/_components/topbar-filter";

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
  // Gerente cadastra (pedido direto do usuário, 2026-08-06), mas não edita
  // nem remove membro nenhum — isso continua exclusivo de owner/admin
  // (canManage acima, controla a coluna de ações e o editar/excluir).
  const canCreate = canManage || me.membership.role === "manager";

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
        <TopbarFilter />
        {canCreate && (
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
              <th>E-mail</th>
              <th>Papel</th>
              <th>Gerente</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="t-co">{memberName(member)}</span>
                </td>
                <td className="t-sub">{memberLogin(member)}</td>
                <td className="t-sub">{memberEmail(member)}</td>
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
                      <form>
                        <input type="hidden" name="id" value={member.id} />
                        <ConfirmSubmitButton
                          formAction={removeMemberAction}
                          confirmMessage={`Remover ${memberName(member)}? Essa ação não pode ser desfeita.`}
                          className="icon-btn danger"
                          title="Excluir"
                        >
                          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                          </svg>
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="empty">
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
