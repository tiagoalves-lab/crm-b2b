import type { MembershipRole, PermissionMatrix } from "@/lib/api/types";

// Espelho do catálogo do backend (src/policy/permission-catalog.ts) — sem
// monorepo/tipos compartilhados (mesmo motivo documentado em
// lib/api/types.ts), mantido à mão. Qualquer mudança de módulo/ação/preset
// tem que ser replicada nos dois lados, ou o checkbox mostrado aqui deixa
// de bater com o que o backend realmente aplica.
//
// Movido de app/dashboard/membros/ pra cá em 2026-08-13: consumido também
// por fora da subpágina de Permissões (ver hasPermission() usado em
// empresas/_ficha/ficha-body.tsx e leads/_ficha/ficha-body.tsx pra decidir
// Editar/Remover na aba Contatos) — não é mais exclusivo do módulo membros.
//
// 2026-08-12: "Empresas" abriu em 7 sub-itens, espelhando as abas da
// ficha (FichaTabs). Dois limites técnicos, documentados no backend (ver
// comentário completo em permission-catalog.ts lá) e refletidos aqui como
// hint de UI:
// - Visão geral/Timeline/Pós-venda só têm "Ver" — essas abas não têm
//   nenhuma ação de criar/editar/excluir própria no app.
// - Tarefas/Oportunidades (dentro da ficha) mostram a grade completa, mas
//   só "Ver" tem efeito PRÓPRIO — criar/editar/excluir de um registro
//   específico sempre valem pelo módulo global (Tarefas/Oportunidades),
//   não importa de onde foi aberto.
export const PERMISSION_MODULES = [
  "empresas_visao_geral",
  "empresas_cadastro",
  "contatos",
  "empresas_timeline",
  "empresas_tarefas",
  "empresas_oportunidades",
  "empresas_posvenda",
  "oportunidades",
  "tarefas",
  "leads",
  "membros",
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_ACTIONS = ["ver", "criar", "editar", "excluir"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const MODULE_LABELS: Record<PermissionModule, string> = {
  empresas_visao_geral: "Visão geral",
  empresas_cadastro: "Dados cadastrais",
  contatos: "Contatos",
  empresas_timeline: "Timeline",
  empresas_tarefas: "Tarefas (nesta empresa)",
  empresas_oportunidades: "Oportunidades (nesta empresa)",
  empresas_posvenda: "Pós-venda",
  oportunidades: "Oportunidades",
  tarefas: "Tarefas",
  leads: "Leads / Prospecção",
  membros: "Membros",
};

// Agrupamento visual — sub-itens de "Empresas" (abas da ficha) aparecem
// com um cabeçalho de grupo na subpágina de Permissões; null = módulo
// solto (não agrupado).
export const MODULE_GROUP: Record<PermissionModule, string | null> = {
  empresas_visao_geral: "Empresas",
  empresas_cadastro: "Empresas",
  contatos: "Empresas",
  empresas_timeline: "Empresas",
  empresas_tarefas: "Empresas",
  empresas_oportunidades: "Empresas",
  empresas_posvenda: "Empresas",
  oportunidades: null,
  tarefas: null,
  leads: null,
  membros: null,
};

// Nota curta por módulo pra deixar claro, na hora, quando um checkbox não
// tem efeito próprio (ver comentário de topo) — evita o usuário achar que
// desligou algo que na prática continua valendo pelo módulo global.
export const MODULE_HINTS: Partial<Record<PermissionModule, string>> = {
  empresas_tarefas:
    "Só \"Ver\" controla algo aqui (a aba aparecer + a lista desta empresa). Criar/editar/excluir de uma tarefa sempre seguem o módulo Tarefas (geral).",
  empresas_oportunidades:
    "Só \"Ver\" controla algo aqui (a aba aparecer + a lista desta empresa). Criar/editar/excluir de uma oportunidade sempre seguem o módulo Oportunidades (geral).",
};

export const ACTION_LABELS: Record<PermissionAction, string> = {
  ver: "Ver",
  criar: "Criar",
  editar: "Editar",
  excluir: "Excluir",
};

// "membros" só tem ver/criar — editar/excluir de membro continua fixo em
// owner/admin no backend (meta-permissão, não vira checkbox). Visão
// geral/Timeline/Pós-venda só têm "ver" — sem ação de criar/editar/
// excluir própria no app (ver comentário de topo).
export const MODULE_ACTIONS: Record<PermissionModule, readonly PermissionAction[]> = {
  empresas_visao_geral: ["ver"],
  empresas_cadastro: PERMISSION_ACTIONS,
  contatos: PERMISSION_ACTIONS,
  empresas_timeline: ["ver"],
  empresas_tarefas: PERMISSION_ACTIONS,
  empresas_oportunidades: PERMISSION_ACTIONS,
  empresas_posvenda: ["ver"],
  oportunidades: PERMISSION_ACTIONS,
  tarefas: PERMISSION_ACTIONS,
  leads: PERMISSION_ACTIONS,
  membros: ["ver", "criar"],
};

const allTrue: Partial<Record<PermissionAction, boolean>> = {
  ver: true,
  criar: true,
  editar: true,
  excluir: true,
};
const viewOnly: Partial<Record<PermissionAction, boolean>> = { ver: true };
const noDelete: Partial<Record<PermissionAction, boolean>> = {
  ver: true,
  criar: true,
  editar: true,
  excluir: false,
};
const contatosDefault: Partial<Record<PermissionAction, boolean>> = {
  ver: true,
  criar: true,
  editar: false,
  excluir: false,
};

// Mesmos presets do backend (DEFAULT_PERMISSIONS) — usado como ponto de
// partida ao escolher um Papel na criação de um membro, e como o que
// "copiar permissões de" traz quando o membro copiado nunca teve a matriz
// customizada (permissions null).
export const DEFAULT_PERMISSIONS: Record<MembershipRole, PermissionMatrix> = {
  owner: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: allTrue,
    contatos: allTrue,
    empresas_timeline: viewOnly,
    empresas_tarefas: allTrue,
    empresas_oportunidades: allTrue,
    empresas_posvenda: viewOnly,
    oportunidades: allTrue,
    tarefas: allTrue,
    leads: allTrue,
    membros: { ver: true, criar: true },
  },
  admin: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: allTrue,
    contatos: allTrue,
    empresas_timeline: viewOnly,
    empresas_tarefas: allTrue,
    empresas_oportunidades: allTrue,
    empresas_posvenda: viewOnly,
    oportunidades: allTrue,
    tarefas: allTrue,
    leads: allTrue,
    membros: { ver: true, criar: true },
  },
  manager: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: allTrue,
    contatos: contatosDefault,
    empresas_timeline: viewOnly,
    empresas_tarefas: allTrue,
    empresas_oportunidades: allTrue,
    empresas_posvenda: viewOnly,
    oportunidades: allTrue,
    tarefas: allTrue,
    leads: allTrue,
    membros: { ver: true, criar: true },
  },
  sales_rep: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: noDelete,
    contatos: contatosDefault,
    empresas_timeline: viewOnly,
    empresas_tarefas: noDelete,
    empresas_oportunidades: noDelete,
    empresas_posvenda: viewOnly,
    oportunidades: noDelete,
    tarefas: noDelete,
    leads: noDelete,
    membros: { ver: true, criar: false },
  },
  readonly: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: viewOnly,
    contatos: viewOnly,
    empresas_timeline: viewOnly,
    empresas_tarefas: viewOnly,
    empresas_oportunidades: viewOnly,
    empresas_posvenda: viewOnly,
    oportunidades: viewOnly,
    tarefas: viewOnly,
    leads: viewOnly,
    membros: viewOnly,
  },
};

export function effectivePermissions(
  role: MembershipRole,
  matrix: PermissionMatrix | null | undefined,
): PermissionMatrix {
  const preset = DEFAULT_PERMISSIONS[role];
  const merged: PermissionMatrix = {};
  for (const mod of PERMISSION_MODULES) {
    merged[mod] = { ...preset[mod], ...matrix?.[mod] };
  }
  return merged;
}

// Espelho de PolicyService.canModule() no backend — owner/admin sempre
// true (bypass, nunca consultam a matriz, mesmo que ela tenha sido salva
// com algo em false), o resto cai pra effectivePermissions(). Usado fora
// da subpágina de Permissões (ex.: mostrar/esconder Editar/Remover na aba
// Contatos da ficha de Empresa/Lead) pra decidir se um BOTÃO aparece — a
// checagem que de fato importa continua sendo a do backend em cada
// endpoint, isto aqui só evita mostrar um botão que ia dar 403.
export function hasPermission(
  role: MembershipRole,
  matrix: PermissionMatrix | null | undefined,
  module: PermissionModule,
  action: PermissionAction,
): boolean {
  if (role === "owner" || role === "admin") return true;
  return effectivePermissions(role, matrix)[module]?.[action] ?? false;
}
