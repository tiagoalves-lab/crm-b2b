import type { Membership } from "@/lib/api/types";
import { removeMemberAction, updateMemberAction } from "./actions";
import ConfirmSubmitButton from "./confirm-submit-button";
import { ROLE_LABELS, ROLE_OPTIONS, memberName } from "./roles";

// Modal "Editar membro" (interceptado, e o fallback de página cheia em
// /dashboard/membros/[id]/editar — ver @modal/(.)membros/[id]/editar).
// Salvar (action padrão do form) e Remover (formAction, mesmo form —
// React permite um botão sobrescrever a Server Action só pra ele) ficam
// lado a lado, a pedido do usuário. Remover pede confirmação antes de
// submeter (ConfirmSubmitButton).
export default function MemberEditForm({
  member,
  members,
}: {
  member: Membership;
  members: Membership[];
}) {
  return (
    <div>
      <form action={updateMemberAction} className="form-grid">
        <input type="hidden" name="id" value={member.id} />
        <label>
          Nome*
          <input
            type="text"
            name="name"
            required
            minLength={2}
            maxLength={255}
            defaultValue={member.name ?? ""}
            autoComplete="off"
          />
        </label>
        <label>
          Login
          <input type="text" defaultValue={member.login ?? "—"} disabled />
        </label>
        <label>
          Nova senha
          <input
            type="password"
            name="password"
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            placeholder="deixe em branco pra manter"
          />
        </label>
        <label>
          Papel
          <select name="role" defaultValue={member.role}>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gerente
          <select name="managerId" defaultValue={member.managerId ?? ""}>
            <option value="">— sem gerente —</option>
            {members
              .filter((other) => other.id !== member.id)
              .map((other) => (
                <option key={other.id} value={other.id}>
                  {memberName(other)} ({ROLE_LABELS[other.role]})
                </option>
              ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={member.status}>
            <option value="active">Ativo</option>
            <option value="suspended">Suspenso</option>
          </select>
        </label>
        <div className="row-form" style={{ marginTop: 4 }}>
          <button type="submit" className="btn btn-primary">
            Salvar
          </button>
          <ConfirmSubmitButton
            formAction={removeMemberAction}
            confirmMessage={`Remover ${memberName(member)}? Essa ação não pode ser desfeita.`}
            className="btn btn-danger"
          >
            Remover
          </ConfirmSubmitButton>
        </div>
      </form>
      <p className="field-hint">
        Não existe como ver a senha atual (nem o Supabase guarda em texto
        puro) — preencher &ldquo;Nova senha&rdquo; substitui a atual e comunica
        direto pro membro.
      </p>
    </div>
  );
}
