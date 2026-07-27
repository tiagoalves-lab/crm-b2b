import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import type { Membership, MembershipRole } from "@/lib/api/types";
import { updateMemberAction } from "./actions";

const ROLE_OPTIONS: MembershipRole[] = [
  "owner",
  "admin",
  "manager",
  "sales_rep",
  "readonly",
];

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Gerente",
  sales_rep: "Representante",
  readonly: "Leitura",
};

// Membership não guarda nome/e-mail (só userId, FK lógica pra auth.users
// do Supabase) — mostrar o e-mail de outra pessoa exigiria consultar a
// Admin API do Supabase com a service_role key, que nunca pode entrar em
// web/ (docs/seguranca.md). Pra uma ferramenta interna pequena, id curto
// + destaque "Você" já basta por enquanto.
function displayName(userId: string, meUserId: string): string {
  return userId === meUserId ? "Você" : `${userId.slice(0, 8)}…`;
}

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
    return manager ? displayName(manager.userId, me.user.id) : "—";
  };

  return (
    <div className="content-wide">
      <div className="panel-head">
        <h2>Membros do workspace</h2>
        <p className="sub">
          {members.length} membro(s) — representante gerencia o próprio,
          gerente vê o próprio + o dos subordinados (definido aqui).
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Papel</th>
            <th>Gerente</th>
            <th>Status</th>
            {canManage && <th>Ação</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td>{displayName(member.userId, me.user.id)}</td>
              {canManage ? (
                <td colSpan={3}>
                  <form action={updateMemberAction} className="row-form">
                    <input type="hidden" name="id" value={member.id} />
                    <select name="role" defaultValue={member.role}>
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    <select name="managerId" defaultValue={member.managerId ?? ""}>
                      <option value="">— sem gerente —</option>
                      {members
                        .filter((other) => other.id !== member.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {displayName(other.userId, me.user.id)} ({ROLE_LABELS[other.role]})
                          </option>
                        ))}
                    </select>
                    <select name="status" defaultValue={member.status}>
                      <option value="active">Ativo</option>
                      <option value="suspended">Suspenso</option>
                    </select>
                    <button type="submit" className="btn btn-primary btn-sm">
                      Salvar
                    </button>
                  </form>
                </td>
              ) : (
                <>
                  <td>{ROLE_LABELS[member.role]}</td>
                  <td>{managerName(member.managerId)}</td>
                  <td>
                    <span
                      className={
                        member.status === "active" ? "badge badge-accent" : "badge badge-danger"
                      }
                    >
                      {member.status === "active" ? "Ativo" : "Suspenso"}
                    </span>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
