"use client";

import { useState } from "react";
import type { Membership, MembershipRole, PermissionMatrix } from "@/lib/api/types";
import { removeMemberAction, updateMemberAction } from "./actions";
import ConfirmSubmitButton from "./confirm-submit-button";
import PasswordConfirmFields from "./password-confirm-fields";
import { effectivePermissions } from "@/lib/api/permission-catalog";
import PermissionsEditor from "./permissions-editor";
import { ROLE_LABELS, ROLE_OPTIONS, memberName } from "./roles";
import SubmitButton from "@/app/_components/submit-button";

type Tab = "dados" | "permissoes";

// Modal "Editar membro" (interceptado, e o fallback de página cheia em
// /dashboard/membros/[id]/editar — ver @modal/(.)membros/[id]/editar).
// Salvar (action padrão do form) e Remover (formAction, mesmo form —
// React permite um botão sobrescrever a Server Action só pra ele) ficam
// lado a lado, a pedido do usuário. Remover pede confirmação antes de
// submeter (ConfirmSubmitButton).
//
// Subpágina de Permissões (2026-08-12): mesma estrutura de abas de
// MemberForm (criação) — ver comentário lá sobre por que são duas `<div>`
// diretas do `<form>` em vez de uma envolvendo tudo. Estado inicial da
// matriz vem do membro já salvo (member.permissions), com fallback pro
// preset do papel atual quando nunca foi customizada (effectivePermissions).
export default function MemberEditForm({
  member,
  members,
}: {
  member: Membership;
  members: Membership[];
}) {
  const [tab, setTab] = useState<Tab>("dados");
  const [role, setRole] = useState<MembershipRole>(member.role);
  const [permissions, setPermissions] = useState<PermissionMatrix>(
    effectivePermissions(member.role, member.permissions),
  );

  return (
    <div>
      <div className="row-form" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={tab === "dados" ? "drawer-tab active" : "drawer-tab"}
          onClick={() => setTab("dados")}
        >
          Dados do membro
        </button>
        <button
          type="button"
          className={tab === "permissoes" ? "drawer-tab active" : "drawer-tab"}
          onClick={() => setTab("permissoes")}
        >
          Permissões
        </button>
      </div>
      <form action={updateMemberAction}>
        <input type="hidden" name="id" value={member.id} />
        <div className="form-grid" hidden={tab !== "dados"}>
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
            Login*
            <input
              type="text"
              name="login"
              required
              minLength={3}
              maxLength={255}
              defaultValue={member.login ?? ""}
              autoComplete="off"
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              name="email"
              maxLength={255}
              defaultValue={member.email ?? ""}
              autoComplete="off"
            />
          </label>
          <PasswordConfirmFields label="Nova senha" placeholder="deixe em branco pra manter" />
          <label>
            Papel
            <select
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value as MembershipRole)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
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
        </div>

        <div hidden={tab !== "permissoes"}>
          <PermissionsEditor
            role={role}
            matrix={permissions}
            onChange={setPermissions}
            members={members}
            excludeMemberId={member.id}
          />
        </div>

        <div className="row-form" style={{ marginTop: 14 }}>
          <SubmitButton className="btn btn-primary" pendingLabel="Salvando…">
            Salvar
          </SubmitButton>
          <ConfirmSubmitButton
            formAction={removeMemberAction}
            confirmMessage={`Remover ${memberName(member)}? Essa ação não pode ser desfeita.`}
            className="btn btn-danger"
          >
            Remover
          </ConfirmSubmitButton>
        </div>
      </form>
      {tab === "dados" && (
        <p className="field-hint">
          Alterar o Login muda o identificador usado pra entrar na plataforma —
          comunique o novo login direto pro membro. Não existe como ver a senha
          atual (nem o Supabase guarda em texto puro) — preencher &ldquo;Nova
          senha&rdquo; substitui a atual e comunica direto pro membro.
        </p>
      )}
    </div>
  );
}
