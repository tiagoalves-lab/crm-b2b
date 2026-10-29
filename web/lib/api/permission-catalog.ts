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
  "empresas_vendas",
  "empresas_posvenda",
  "oportunidades",
  "tarefas",
  "leads",
  "membros",
  // Item "Treinamento" do menu lateral (2026-09-17) — espelho do backend.
  "treinamento",
  // Telefonia (2026-09-23) — espelho do backend. "Criar" é ligar pelo CRM.
  "telefonia",
  // Console fiscal (2026-10-20) — espelho do backend. "Editar" (2026-10-22) é ligar retorno à remessa.
  "fiscal",
  "relatorios_financeiros",
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
  empresas_vendas: "Vendas, ABC de Produtos e Serviços",
  empresas_posvenda: "Pós-venda",
  oportunidades: "Oportunidades",
  tarefas: "Tarefas",
  leads: "Leads / Prospecção",
  membros: "Membros",
  treinamento: "Treinamento",
  telefonia: "Telefonia",
  fiscal: "Console fiscal",
  relatorios_financeiros: "Relatórios financeiros",
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
  empresas_vendas: "Empresas",
  empresas_posvenda: "Empresas",
  oportunidades: null,
  tarefas: null,
  leads: null,
  membros: null,
  treinamento: null,
  telefonia: null,
  fiscal: null,
  relatorios_financeiros: null,
};

// Nota curta por módulo pra deixar claro, na hora, quando um checkbox não
// tem efeito próprio (ver comentário de topo) — evita o usuário achar que
// desligou algo que na prática continua valendo pelo módulo global.
export const MODULE_HINTS: Partial<Record<PermissionModule, string>> = {
  empresas_tarefas:
    "Só \"Ver\" controla algo aqui (a aba aparecer + a lista desta empresa). Criar/editar/excluir de uma tarefa sempre seguem o módulo Tarefas (geral).",
  empresas_oportunidades:
    "Só \"Ver\" controla algo aqui (a aba aparecer + a lista desta empresa). Criar/editar/excluir de uma oportunidade sempre seguem o módulo Oportunidades (geral).",
  empresas_vendas:
    "Cobre as três abas de faturamento da ficha: Vendas, ABC de Produtos e Serviços. Vem DESLIGADO para representante — o histórico de compra do cliente é informação de gestão.",
  telefonia:
    "\"Criar\" é poder ligar pelo CRM; \"Ver\" é enxergar o histórico de chamadas. A ligação sai pelo programa de telefone instalado no computador (MicroSIP).",
  fiscal:
    "\"Ver\" libera o item Console fiscal no menu lateral: notas emitidas, impostos e remessas. \"Editar\" é poder ligar a nota de retorno à remessa no Controle de remessas. Vale também para Admin: vem LIGADO para Admin e DESLIGADO para os demais — faturamento e imposto são informação de gestão. Só o Owner vê sempre.",
  relatorios_financeiros:
    "Libera os relatórios financeiros na tela Relatórios. Vem DESLIGADO para todos, Admin incluído — só o Owner vê sempre, e só quem já tem este acesso consegue liberá-lo para outro membro.",
  treinamento:
    "Libera o item Treinamento no menu lateral, com os slides de uso do CRM. Vem DESLIGADO para todos — marque membro a membro.",
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
  empresas_vendas: ["ver"],
  empresas_posvenda: ["ver"],
  oportunidades: PERMISSION_ACTIONS,
  tarefas: PERMISSION_ACTIONS,
  leads: PERMISSION_ACTIONS,
  membros: ["ver", "criar"],
  treinamento: ["ver"],
  telefonia: ["ver", "criar"],
  fiscal: ["ver", "editar"],
  relatorios_financeiros: ["ver"],
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
const telefoniaCompleta: Partial<Record<PermissionAction, boolean>> = {
  ver: true,
  criar: true,
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
    empresas_vendas: viewOnly,
    empresas_posvenda: viewOnly,
    oportunidades: allTrue,
    tarefas: allTrue,
    leads: allTrue,
    membros: { ver: true, criar: true },
    treinamento: viewOnly,
    telefonia: telefoniaCompleta,
    fiscal: { ver: true, editar: true },
    relatorios_financeiros: { ver: true },
  },
  admin: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: allTrue,
    contatos: allTrue,
    empresas_timeline: viewOnly,
    empresas_tarefas: allTrue,
    empresas_oportunidades: allTrue,
    empresas_vendas: viewOnly,
    empresas_posvenda: viewOnly,
    oportunidades: allTrue,
    tarefas: allTrue,
    leads: allTrue,
    membros: { ver: true, criar: true },
    treinamento: viewOnly,
    telefonia: telefoniaCompleta,
    fiscal: { ver: true, editar: true },
    relatorios_financeiros: { ver: false },
  },
  manager: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: allTrue,
    contatos: contatosDefault,
    empresas_timeline: viewOnly,
    empresas_tarefas: allTrue,
    empresas_oportunidades: allTrue,
    empresas_vendas: viewOnly,
    empresas_posvenda: viewOnly,
    oportunidades: allTrue,
    tarefas: allTrue,
    leads: allTrue,
    membros: { ver: true, criar: true },
    treinamento: { ver: false },
    telefonia: telefoniaCompleta,
    fiscal: { ver: false },
    relatorios_financeiros: { ver: false },
  },
  sales_rep: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: noDelete,
    contatos: contatosDefault,
    empresas_timeline: viewOnly,
    empresas_tarefas: noDelete,
    empresas_oportunidades: noDelete,
    // Espelha o backend (src/policy/permission-catalog.ts): único módulo
    // que nasce desligado pro representante — diretriz do usuário,
    // 2026-08-20.
    empresas_vendas: { ver: false },
    empresas_posvenda: viewOnly,
    oportunidades: noDelete,
    tarefas: noDelete,
    leads: noDelete,
    membros: { ver: true, criar: false },
    treinamento: { ver: false },
    telefonia: telefoniaCompleta,
    fiscal: { ver: false },
    relatorios_financeiros: { ver: false },
  },
  readonly: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: viewOnly,
    contatos: viewOnly,
    empresas_timeline: viewOnly,
    empresas_tarefas: viewOnly,
    empresas_oportunidades: viewOnly,
    empresas_vendas: viewOnly,
    empresas_posvenda: viewOnly,
    oportunidades: viewOnly,
    tarefas: viewOnly,
    leads: viewOnly,
    membros: viewOnly,
    treinamento: { ver: false },
    telefonia: viewOnly,
    fiscal: { ver: false },
    relatorios_financeiros: { ver: false },
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

// Espelho do backend: módulos em que o admin segue a matriz, sem bypass
// (2026-10-22, "alguns admins não podem ter acesso ao console"). Só o
// owner passa direto.
export const MODULOS_SEM_BYPASS_ADMIN: ReadonlySet<PermissionModule> = new Set<PermissionModule>([
  "fiscal",
  "relatorios_financeiros",
]);

// Papel que passa direto (ignora a caixa) naquele módulo.
export function temBypass(role: MembershipRole, module: PermissionModule): boolean {
  return role === "owner" || (role === "admin" && !MODULOS_SEM_BYPASS_ADMIN.has(module));
}

// Espelho de PolicyService.canModule() no backend — owner/admin sempre
// true (bypass, nunca consultam a matriz, mesmo que ela tenha sido salva
// com algo em false), exceto o admin nos MODULOS_SEM_BYPASS_ADMIN; o
// resto cai pra effectivePermissions(). Usado fora
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
  if (temBypass(role, module)) return true;
  return effectivePermissions(role, matrix)[module]?.[action] ?? false;
}
