"use client";

import { Fragment } from "react";
import type { Membership, MembershipRole, PermissionMatrix } from "@/lib/api/types";
import {
  ACTION_LABELS,
  DEFAULT_PERMISSIONS,
  MODULE_ACTIONS,
  MODULE_GROUP,
  MODULE_HINTS,
  MODULE_LABELS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  effectivePermissions,
  type PermissionModule,
} from "@/lib/api/permission-catalog";
import { ROLE_LABELS, memberName } from "./roles";

// Subpágina de Permissões do modal de membro (pedido direto do usuário,
// 2026-08-12) — grade de checkbox módulo×ação + "copiar permissões de".
// Controlado pelo pai (MemberForm/MemberEditForm), que carrega o estado
// num input hidden (name="permissions", JSON.stringify) pra viajar junto
// no FormData da Server Action — os checkboxes aqui não têm `name`
// próprio de propósito, só refletem/editam o objeto React.
//
// Módulos vêm agrupados (MODULE_GROUP) — "Empresas" reúne as 7 sub-abas
// da ficha (pedido em seguida, mesmo dia), renderizadas com um cabeçalho
// de grupo antes da primeira linha de cada grupo novo. MODULE_HINTS marca
// as duas linhas (Tarefas/Oportunidades dentro da empresa) onde só "Ver"
// tem efeito próprio — ver comentário em permission-catalog.ts.
export default function PermissionsEditor({
  role,
  matrix,
  onChange,
  members,
  excludeMemberId,
}: {
  role: MembershipRole;
  matrix: PermissionMatrix;
  onChange: (matrix: PermissionMatrix) => void;
  members: Membership[];
  excludeMemberId?: string;
}) {
  const isBypass = role === "owner" || role === "admin";
  const copyCandidates = members.filter((m) => m.id !== excludeMemberId);

  function toggle(module: PermissionModule, action: string, checked: boolean) {
    onChange({
      ...matrix,
      [module]: { ...matrix[module], [action]: checked },
    });
  }

  function copyFrom(memberId: string) {
    const source = members.find((m) => m.id === memberId);
    if (!source) return;
    onChange(effectivePermissions(source.role, source.permissions));
  }

  function resetToRoleDefault() {
    onChange(DEFAULT_PERMISSIONS[role]);
  }

  let lastGroup: string | null = null;

  return (
    <div>
      {isBypass ? (
        <p className="field-hint">
          {ROLE_LABELS[role]} tem acesso total em todo o sistema — a matriz
          abaixo não se aplica a este papel (fica salva, mas ignorada
          enquanto o membro continuar como {ROLE_LABELS[role]}).
        </p>
      ) : (
        <p className="field-hint">
          Controla exatamente o que este membro pode fazer em cada área.
          Marcado = permitido.
        </p>
      )}

      <div className="row-form" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ flex: 1, minWidth: 220 }}>
          Copiar permissões de
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) copyFrom(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">— selecione um membro —</option>
            {copyCandidates.map((m) => (
              <option key={m.id} value={m.id}>
                {memberName(m)} ({ROLE_LABELS[m.role]})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={resetToRoleDefault}
          style={{ alignSelf: "flex-end" }}
        >
          Restaurar padrão de {ROLE_LABELS[role]}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Módulo</th>
              {PERMISSION_ACTIONS.map((action) => (
                <th key={action} style={{ textAlign: "center" }}>
                  {ACTION_LABELS[action]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((module) => {
              const group = MODULE_GROUP[module];
              const showGroupHeader = group !== null && group !== lastGroup;
              lastGroup = group;
              const hint = MODULE_HINTS[module];

              return (
                <Fragment key={module}>
                  {showGroupHeader && (
                    <tr key={`group-${group}`}>
                      <td
                        colSpan={PERMISSION_ACTIONS.length + 1}
                        style={{
                          background: "var(--surface-sunken)",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          color: "var(--text-tertiary)",
                          fontWeight: 500,
                        }}
                      >
                        {group}
                      </td>
                    </tr>
                  )}
                  <tr key={module}>
                    <td style={group ? { paddingLeft: 24 } : undefined}>
                      {MODULE_LABELS[module]}
                      {hint && (
                        <>
                          {" "}
                          <span title={hint} aria-label={hint} style={{ cursor: "help" }}>
                            ⓘ
                          </span>
                        </>
                      )}
                    </td>
                    {PERMISSION_ACTIONS.map((action) => {
                      const applies = MODULE_ACTIONS[module].includes(action);
                      return (
                        <td key={action} style={{ textAlign: "center" }}>
                          {applies ? (
                            <input
                              type="checkbox"
                              checked={matrix[module]?.[action] ?? false}
                              disabled={isBypass}
                              onChange={(e) => toggle(module, action, e.target.checked)}
                              style={{
                                width: 16,
                                height: 16,
                                padding: 0,
                                border: "none",
                                borderRadius: 0,
                                background: "transparent",
                              }}
                            />
                          ) : (
                            <span aria-hidden="true">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <input type="hidden" name="permissions" value={JSON.stringify(matrix)} />
    </div>
  );
}
