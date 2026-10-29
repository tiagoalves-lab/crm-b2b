import Link from "next/link";
import { Fragment } from "react";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import type { Membership, MembershipRole } from "@/lib/api/types";
import {
  ACTION_LABELS,
  DEFAULT_PERMISSIONS,
  MODULE_ACTIONS,
  MODULE_GROUP,
  MODULE_LABELS,
  PERMISSION_MODULES,
  hasPermission,
  temBypass,
  type PermissionModule,
} from "@/lib/api/permission-catalog";
import { ADMIN_TABS, NAV_ITEMS } from "../../../nav-items";
import { ROLE_LABELS, ROLE_PILL, memberName } from "../roles";
import MatrizScroll from "./matriz-scroll";

// Matriz membros × permissões (pedido do usuário, 2026-10-26): conferir de
// uma vez o que cada membro pode, sem abrir a ficha de um por um. Só
// leitura — mudar continua sendo na ficha do membro (aba Permissões).
// Mesma regra de cálculo do resto do app (hasPermission), então o que
// aparece aqui é o que o membro de fato consegue fazer.

// Ordem das colunas: quem tem mais acesso primeiro.
const ROLE_ORDER: Record<MembershipRole, number> = {
  owner: 0,
  admin: 1,
  manager: 2,
  sales_rep: 3,
  readonly: 4,
};

const ACTION_SHORT = { ver: "V", criar: "C", editar: "E", excluir: "X" } as const;

// Acesso que não passa pela matriz: telas liberadas ou travadas pelo papel.
// Lido de nav-items.ts pra nunca divergir do menu de verdade. Do menu
// lateral entram só as telas sem módulo próprio na matriz (Funil,
// Oportunidades, Tarefas e Carteira já estão nas linhas de cima).
const TELAS_SEM_MODULO = new Set(["/dashboard", "/dashboard/relatorios"]);
const ACESSO_POR_PAPEL: { label: string; roles?: MembershipRole[] }[] = [
  ...NAV_ITEMS.filter((item) => TELAS_SEM_MODULO.has(item.href)).map((item) => ({
    label: item.label,
    roles: item.roles,
  })),
  ...ADMIN_TABS.map((tab) => ({ label: `Administração › ${tab.label}`, roles: tab.roles })),
  { label: "Administração › Membros: editar e remover", roles: ["owner", "admin"] },
];

function personalizado(member: Membership, module: PermissionModule): boolean {
  const custom = member.permissions?.[module];
  if (!custom || temBypass(member.role, module)) return false;
  const preset = DEFAULT_PERMISSIONS[member.role][module] ?? {};
  return MODULE_ACTIONS[module].some(
    (action) => custom[action] !== undefined && custom[action] !== (preset[action] ?? false),
  );
}

export default async function MatrizPermissoesPage() {
  const token = await getServerAccessToken();
  const [me, members] = await Promise.all([getMe(token), listMemberships(token)]);
  const canManage = me.membership.role === "owner" || me.membership.role === "admin";

  if (!canManage) {
    return (
      <div className="content">
        <div className="error-banner">Só Owner e Admin veem a matriz de permissões.</div>
      </div>
    );
  }

  const colunas = [...members].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || memberName(a).localeCompare(memberName(b), "pt-BR"),
  );

  let lastGroup: string | null = null;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Matriz de permissões</div>
          <div className="page-sub">
            {members.length} membro(s) — o que cada um consegue fazer hoje. Para mudar, abra o membro em
            Administração › Membros.
          </div>
        </div>
        <Link href="/dashboard/membros" className="btn btn-ghost">
          Voltar para Membros
        </Link>
      </div>

      <div className="content" style={{ paddingBottom: 0 }}>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          <strong>V</strong> {ACTION_LABELS.ver} · <strong>C</strong> {ACTION_LABELS.criar} · <strong>E</strong>{" "}
          {ACTION_LABELS.editar} · <strong>X</strong> {ACTION_LABELS.excluir}. Letra apagada = sem acesso.{" "}
          <strong>Total</strong> = o papel libera tudo, sem depender de caixa. <span style={{ color: "var(--accent)" }}>●</span>{" "}
          = mudado à mão em relação ao padrão do papel.
        </p>

        <MatrizScroll>
          <table className="data-table">
            <thead>
              <tr>
                <th>Módulo</th>
                {colunas.map((m) => (
                  <th key={m.id} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <div>{memberName(m)}</div>
                    <span className={ROLE_PILL[m.role]}>{ROLE_LABELS[m.role]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MODULES.map((module) => {
                const group = MODULE_GROUP[module];
                const showGroupHeader = group !== null && group !== lastGroup;
                lastGroup = group;
                return (
                  <Fragment key={module}>
                    {showGroupHeader && (
                      <tr className="matriz-grupo">
                        <td>{group}</td>
                        <td colSpan={colunas.length} />
                      </tr>
                    )}
                    <tr>
                      <td style={group ? { paddingLeft: 24 } : undefined}>
                        {MODULE_LABELS[module]}
                      </td>
                      {colunas.map((m) => (
                        <td key={m.id} style={{ textAlign: "center", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                          {temBypass(m.role, module) ? (
                            <span style={{ color: "var(--green)", fontWeight: 600 }}>Total</span>
                          ) : (
                            <>
                              {MODULE_ACTIONS[module].map((action) => {
                                const pode = hasPermission(m.role, m.permissions, module, action);
                                return (
                                  <span
                                    key={action}
                                    title={`${ACTION_LABELS[action]}: ${pode ? "sim" : "não"}`}
                                    style={{
                                      margin: "0 2px",
                                      fontWeight: pode ? 600 : 400,
                                      color: pode ? "var(--green)" : "var(--text-tertiary)",
                                      opacity: pode ? 1 : 0.35,
                                    }}
                                  >
                                    {ACTION_SHORT[action]}
                                  </span>
                                );
                              })}
                              {personalizado(m, module) && (
                                <span title="Mudado à mão" style={{ color: "var(--accent)", marginLeft: 2 }}>
                                  ●
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}

              <tr className="matriz-grupo">
                <td>Telas liberadas pelo papel</td>
                <td colSpan={colunas.length} />
              </tr>
              {ACESSO_POR_PAPEL.map((linha) => (
                <tr key={linha.label}>
                  <td style={{ paddingLeft: 24 }}>{linha.label}</td>
                  {colunas.map((m) => {
                    const pode = !linha.roles || linha.roles.includes(m.role);
                    return (
                      <td
                        key={m.id}
                        style={{
                          textAlign: "center",
                          fontWeight: pode ? 600 : 400,
                          color: pode ? "var(--green)" : "var(--text-tertiary)",
                          opacity: pode ? 1 : 0.35,
                        }}
                      >
                        {pode ? "Sim" : "Não"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </MatrizScroll>
      </div>
    </>
  );
}
