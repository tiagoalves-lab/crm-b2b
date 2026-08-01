import type { Membership } from "@/lib/api/types";
import { createMemberAction } from "./actions";
import { ROLE_LABELS, ROLE_OPTIONS, memberName } from "./roles";

// Usado pelo cadastro de membro (modal "Novo membro", interceptado, e o
// fallback de página cheia em /dashboard/membros/novo — ver
// @modal/(.)membros/novo). Cria nome+login+senha (login é texto livre,
// sem e-mail — ver actions.ts) e já entra no workspace.
export default function MemberForm({ members }: { members: Membership[] }) {
  return (
    <div>
      <form action={createMemberAction} className="form-grid">
        <label>
          Nome*
          <input type="text" name="name" required minLength={2} maxLength={255} autoComplete="off" />
        </label>
        <label>
          Login*
          <input type="text" name="login" required minLength={3} maxLength={255} autoComplete="off" />
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
                {memberName(m)} ({ROLE_LABELS[m.role]})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">
          Criar membro
        </button>
      </form>
      <p className="field-hint">
        Senha com mínimo de 8 caracteres. Comunique login e senha direto pro
        membro — não existe convite automático ainda.
      </p>
    </div>
  );
}
