import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import type { Membership, MembershipRole } from "@/lib/api/types";
import { createMemberAction, removeMemberAction, updateMemberAction } from "./actions";

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

      {canManage && (
        <div className="form-panel">
          <div className="panel-head">
            <h3 style={{ fontSize: 14 }}>Novo membro</h3>
            <p className="sub">Cria o login (e-mail/senha) e já entra no workspace.</p>
          </div>
          <form action={createMemberAction} className="form-grid">
            <label>
              Login*
              <input type="email" name="email" required maxLength={255} autoComplete="off" placeholder="login@empresa.com.br" />
            </label>
            <label>
              Senha*
              <input
                type="password"
                name="password"
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
              />
            </label>
            <label>
              Papel
              <select name="role" defaultValue="sales_rep">
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Gerente
              <select name="managerId" defaultValue="">
                <option value="">— sem gerente —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {displayName(m.userId, me.user.id)} ({ROLE_LABELS[m.role]})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary">
              Criar membro
            </button>
          </form>
          <p className="field-hint">
            Senha com mínimo de 8 caracteres. O login precisa ter formato de e-mail (é assim que o
            Supabase Auth identifica o usuário), mesmo que não seja usado pra receber mensagem —
            comunique login e senha direto pro membro, não existe e-mail de convite ainda.
          </p>
        </div>
      )}

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
                  {member.userId !== me.user.id && (
                    <form action={removeMemberAction} className="row-form">
                      <input type="hidden" name="id" value={member.id} />
                      <button type="submit" className="btn btn-danger btn-sm">
                        Remover
                      </button>
                    </form>
                  )}
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
