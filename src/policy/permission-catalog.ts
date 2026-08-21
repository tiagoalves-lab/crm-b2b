import { BadRequestException } from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import type { PolicyAction } from './policy.types';

// Matriz de permissões granulares (pedido direto do usuário, 2026-08-12):
// substitui o binário fixo que PolicyService tinha antes (sales_rep nunca
// exclui, readonly só lê) por um checkbox real por módulo×ação, editável na
// subpágina de Permissões do cadastro de membro (web/app/dashboard/membros).
//
// Só se aplica a manager/sales_rep/readonly — owner/admin continuam bypass
// total em todo lugar que já checava isso (PolicyService.can/canModule),
// nunca consultam esta matriz. `role` continua existindo no banco e no RLS
// (ver prisma/schema.sql, policies "ws_and_role_select") só para decidir
// ESCOPO (próprio registro vs. equipe via managerId vs. todos) — dimensão
// separada de CAPACIDADE (pode tentar a ação em si), que é o que esta
// matriz decide agora. Ver docs/memorial-do-projeto.md pela decisão
// completa antes de mexer aqui.
//
// 2026-08-12 (mesmo dia, pedido em seguida): "empresas" abriu em 7
// sub-itens, espelhando as abas da ficha (FichaTabs) — MODULE_GROUP marca
// quem pertence ao grupo visual "Empresas" na subpágina. Dois limites
// técnicos deliberados, não esquecimento:
// - empresas_visao_geral/empresas_timeline/empresas_posvenda só têm 'ver'
//   — essas abas não têm nenhuma ação de criar/editar/excluir própria no
//   app (visão geral é resumo de outros dados; timeline é log; pós-venda é
//   espelho read-only do eGestor). Não criar um checkbox pra ação que não
//   existe em lugar nenhum do backend.
// - empresas_tarefas/empresas_oportunidades têm a grade completa (pedido
//   explícito do usuário, "mantém os 4 por consistência visual"), mas só
//   'ver' tem efeito PRÓPRIO no backend — controla a aba aparecer + a
//   listagem filtrada por empresa (TaskService/OpportunityService#findAll,
//   branch por query.companyId). Criar/editar/excluir de uma tarefa ou
//   oportunidade específica sempre passam pelo módulo global (tarefas/
//   oportunidades), não importa de onde foi aberta — não dá pra saber com
//   segurança, num GET/PATCH/DELETE por id, se a origem foi a ficha da
//   empresa ou a tela geral, então não existe como aplicar os dois
//   separadamente sem um mentir pro outro.
// - "contatos" não ganhou um "empresas_" novo: não existe tela de Contatos
//   fora da ficha da empresa/lead, então o módulo que já existia JÁ É
//   essa permissão — só mudou de grupo visual na subpágina.
export const PERMISSION_MODULES = [
  'empresas_visao_geral',
  'empresas_cadastro',
  'contatos',
  'empresas_timeline',
  'empresas_tarefas',
  'empresas_oportunidades',
  'empresas_vendas',
  'empresas_posvenda',
  'oportunidades',
  'tarefas',
  'leads',
  'membros',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_ACTIONS = [
  'ver',
  'criar',
  'editar',
  'excluir',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

// "membros" só tem ver/criar — editar/excluir membro (mudar papel de
// outrem, suspender, remover) é meta-permissão (quem pode dar acesso a
// quem), continua fixa em owner/admin no MembershipService (WRITE_ROLES),
// não vira checkbox: abrir isso seria caminho de escalonamento de
// privilégio. Ver comentário de PERMISSION_MODULES acima pro porquê dos
// módulos empresas_visao_geral/empresas_timeline/empresas_posvenda só
// terem 'ver'.
export const MODULE_ACTIONS: Record<
  PermissionModule,
  readonly PermissionAction[]
> = {
  empresas_visao_geral: ['ver'],
  empresas_cadastro: PERMISSION_ACTIONS,
  contatos: PERMISSION_ACTIONS,
  empresas_timeline: ['ver'],
  empresas_tarefas: PERMISSION_ACTIONS,
  empresas_oportunidades: PERMISSION_ACTIONS,
  empresas_vendas: ['ver'],
  empresas_posvenda: ['ver'],
  oportunidades: PERMISSION_ACTIONS,
  tarefas: PERMISSION_ACTIONS,
  leads: PERMISSION_ACTIONS,
  membros: ['ver', 'criar'],
};

// Agrupamento visual só (subpágina de Permissões) — sem efeito na
// checagem em si, PolicyService trata todo PermissionModule igual.
export const MODULE_GROUP: Record<PermissionModule, string | null> = {
  empresas_visao_geral: 'Empresas',
  empresas_cadastro: 'Empresas',
  contatos: 'Empresas',
  empresas_timeline: 'Empresas',
  empresas_tarefas: 'Empresas',
  empresas_oportunidades: 'Empresas',
  empresas_vendas: 'Empresas',
  empresas_posvenda: 'Empresas',
  oportunidades: null,
  tarefas: null,
  leads: null,
  membros: null,
};

export type PermissionMatrix = {
  [M in PermissionModule]?: Partial<Record<PermissionAction, boolean>>;
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
const membrosManagerDefault: Partial<Record<PermissionAction, boolean>> = {
  ver: true,
  criar: true,
};
const membrosSalesRepDefault: Partial<Record<PermissionAction, boolean>> = {
  ver: true,
  criar: false,
};

// Presets — reproduzem exatamente o comportamento binário que
// PolicyService/MembershipService tinham antes desta feature (fallback
// quando Membership.permissions é null: membro criado antes desta
// migration, ou nunca customizado — e ponto de partida ao escolher um
// papel na criação de um membro novo, antes de o usuário mexer nos
// checkboxes). owner/admin não usam isto (bypass em PolicyService.canModule).
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
  },
  // Manager: mesmo critério de sempre — dono do registro ou subordinado
  // (escopo, inalterado) pode excluir; contatos/membros continuam fora do
  // que o manager mexe por padrão (histórico: editar/excluir contato
  // sempre foi owner/admin only, criar membro é o único ponto que o
  // manager já tinha). Sub-abas da ficha da empresa: todas visíveis por
  // padrão (era o comportamento antes de existirem esses checkboxes).
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
    membros: membrosManagerDefault,
  },
  // sales_rep: nunca exclui (regra antiga, 2026-08-06, "mais restrita que
  // o resto do modelo de ownership" — ver comentário histórico que estava
  // em PolicyService), não mexe em membro.
  sales_rep: {
    empresas_visao_geral: viewOnly,
    empresas_cadastro: noDelete,
    contatos: contatosDefault,
    empresas_timeline: viewOnly,
    empresas_tarefas: noDelete,
    empresas_oportunidades: noDelete,
    // Único módulo que nasce DESLIGADO pro representante (diretriz do
    // usuário, 2026-08-20: "os representantes não visualizam o histórico
    // de venda"). São as abas Vendas / ABC de Produtos / Serviços da
    // ficha da empresa — faturamento por cliente é informação de gestão.
    // Continua sendo um checkbox: dá pra liberar membro a membro na
    // subpágina de Permissões.
    empresas_vendas: { ver: false },
    empresas_posvenda: viewOnly,
    oportunidades: noDelete,
    tarefas: noDelete,
    leads: noDelete,
    membros: membrosSalesRepDefault,
  },
  // readonly: só lê, em qualquer módulo (regra antiga: "action !== 'read'
  // → false" pra este papel).
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
  },
};

export function resolvePermission(
  role: MembershipRole,
  matrix: PermissionMatrix | null | undefined,
  module: PermissionModule,
  action: PermissionAction,
): boolean {
  const custom = matrix?.[module]?.[action];
  if (custom !== undefined) return custom;
  return DEFAULT_PERMISSIONS[role]?.[module]?.[action] ?? false;
}

// 'read'/'write'/'delete' é o vocabulário antigo de PolicyAction, ainda
// usado nos call sites que carregam um OwnedResource pronto (ver
// PolicyService.can) — mapeado pro vocabulário novo da matriz. 'write'
// sempre soa como 'editar' aqui: os call sites que criam um registro novo
// checam 'criar' à parte, direto por canModule(), antes de chamar can().
export function toPermissionAction(action: PolicyAction): PermissionAction {
  if (action === 'read') return 'ver';
  if (action === 'delete') return 'excluir';
  return 'editar';
}

// Validação de shape pra dto.permissions (CreateMembershipDto/
// UpdateMembershipDto) — rejeita módulo/ação desconhecida em vez de
// aceitar e ignorar silenciosamente (silêncio aqui esconderia erro de
// digitação do frontend atrás de um "checkbox que não faz nada").
export function parsePermissionMatrix(input: unknown): PermissionMatrix {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BadRequestException('permissions precisa ser um objeto.');
  }
  const result: PermissionMatrix = {};
  for (const [moduleKey, actions] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (!PERMISSION_MODULES.includes(moduleKey as PermissionModule)) {
      throw new BadRequestException(
        `Módulo de permissão desconhecido: "${moduleKey}".`,
      );
    }
    const module = moduleKey as PermissionModule;
    if (
      typeof actions !== 'object' ||
      actions === null ||
      Array.isArray(actions)
    ) {
      throw new BadRequestException(
        `permissions.${module} precisa ser um objeto.`,
      );
    }
    const allowedActions = MODULE_ACTIONS[module];
    const parsedActions: Partial<Record<PermissionAction, boolean>> = {};
    for (const [actionKey, value] of Object.entries(
      actions as Record<string, unknown>,
    )) {
      if (!allowedActions.includes(actionKey as PermissionAction)) {
        throw new BadRequestException(
          `Ação de permissão desconhecida para "${module}": "${actionKey}".`,
        );
      }
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `permissions.${module}.${actionKey} precisa ser true/false.`,
        );
      }
      parsedActions[actionKey as PermissionAction] = value;
    }
    result[module] = parsedActions;
  }
  return result;
}
