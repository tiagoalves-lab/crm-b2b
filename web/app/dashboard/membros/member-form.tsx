"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { Membership, MembershipRole, PermissionMatrix } from "@/lib/api/types";
import { createMemberAction } from "./actions";
import { DEFAULT_PERMISSIONS } from "@/lib/api/permission-catalog";
import PasswordConfirmFields from "./password-confirm-fields";
import PermissionsEditor from "./permissions-editor";
import { MANAGER_CREATABLE_ROLE_OPTIONS, ROLE_LABELS, ROLE_OPTIONS, memberName } from "./roles";
import SubmitButton from "@/app/_components/submit-button";

type Tab = "dados" | "permissoes";

// Usado pelo cadastro de membro (modal "Novo membro", interceptado, e o
// fallback de página cheia em /dashboard/membros/novo — ver
// @modal/(.)membros/novo). Cria nome+login+senha (login é texto livre,
// sem formato de e-mail exigido — ver actions.ts) e já entra no
// workspace. E-mail é campo à parte, opcional, só pra contato (não é
// usado pra logar — quem loga é o Login). Fecha via
// router.back() depois de criar — ver comentário em
// empresas/company-form.tsx sobre por que back() e não push()/redirect();
// toast via sessionStorage porque back() não aceita querystring.
//
// `actorRole` (pedido direto do usuário, 2026-08-06): gerente também pode
// cadastrar membro agora (antes só owner/admin), mas só Gerente/
// Representante (MembershipService#create rejeita o resto) — o select de
// Papel reflete isso, e o de Gerente some (backend força o próprio gerente
// que está cadastrando, não dá pra escolher outro).
//
// Subpágina de Permissões (2026-08-12, pedido direto do usuário): segunda
// aba do mesmo form/modal — checkbox módulo×ação + "copiar permissões
// de", viaja no mesmo submit via input hidden (ver PermissionsEditor). O
// papel escolhido só define o PONTO DE PARTIDA da matriz (preset padrão,
// re-aplicado toda vez que o select de Papel muda) — o usuário pode
// customizar livremente antes de criar. Duas `<div>` diretas do `<form>`
// (uma pra cada aba, `hidden` alterna) em vez de uma envolvendo tudo —
// `.form-grid` é `display:grid` nos filhos diretos (ver globals.css),
// aninhar quebraria o layout em colunas dos campos de "Dados".
export default function MemberForm({
  members,
  actorRole,
}: {
  members: Membership[];
  actorRole: MembershipRole;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createMemberAction, null);
  const isTeamManager = actorRole === "manager";
  const roleOptions = isTeamManager ? MANAGER_CREATABLE_ROLE_OPTIONS : ROLE_OPTIONS;

  const [tab, setTab] = useState<Tab>("dados");
  const [role, setRole] = useState<MembershipRole>("sales_rep");
  const [permissions, setPermissions] = useState<PermissionMatrix>(
    DEFAULT_PERMISSIONS.sales_rep,
  );

  useEffect(() => {
    if (state?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, "Membro criado");
      router.back();
    }
  }, [state, router]);

  return (
    <div>
      {state?.ok === false && <div className="error-banner">{state.message}</div>}
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
      <form action={formAction}>
        <div className="form-grid" hidden={tab !== "dados"}>
          <label>
            Nome*
            <input type="text" name="name" required minLength={2} maxLength={255} autoComplete="off" />
          </label>
          <label>
            Login*
            <input type="text" name="login" required minLength={3} maxLength={255} autoComplete="off" />
          </label>
          <label>
            E-mail
            <input type="email" name="email" maxLength={255} autoComplete="off" />
          </label>
          <PasswordConfirmFields label="Senha*" required />
          <label>
            Papel
            <select
              name="role"
              value={role}
              onChange={(e) => {
                const next = e.target.value as MembershipRole;
                setRole(next);
                setPermissions(DEFAULT_PERMISSIONS[next]);
              }}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {isTeamManager ? (
            <p className="field-hint">Entra sob a sua gerência.</p>
          ) : (
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
          )}
        </div>

        <div hidden={tab !== "permissoes"}>
          <PermissionsEditor
            role={role}
            matrix={permissions}
            onChange={setPermissions}
            members={members}
          />
        </div>

        <SubmitButton className="btn btn-primary" style={{ marginTop: 14 }} pendingLabel="Criando…">
          Criar membro
        </SubmitButton>
      </form>
      {tab === "dados" && (
        <p className="field-hint">
          Senha com mínimo de 8 caracteres. Comunique login e senha direto pro
          membro — não existe convite automático ainda.
        </p>
      )}
    </div>
  );
}
