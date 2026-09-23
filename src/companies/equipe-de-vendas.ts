import type { MembershipRole } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';

// Papéis com acesso automático a TODA empresa do workspace (regra do
// usuário, 2026-09-21): administrador e proprietário não entram na lista
// da equipe de vendas — estar ou não estar lá não mudaria nada pra eles,
// e a lista fica poluída. Gerente NÃO está aqui de propósito: ele entra
// na equipe como supervisor do representante (regra 1 da mesma data).
export const ROLES_COM_ACESSO_AUTOMATICO: readonly MembershipRole[] = [
  'owner',
  'admin',
];

export function temAcessoAutomatico(role: MembershipRole): boolean {
  return ROLES_COM_ACESSO_AUTOMATICO.includes(role);
}

// Regra 1 da equipe de vendas (pedido do usuário, 2026-09-21): "se for
// inserido via cadastro manual o prospect herda o login do representante
// e seu supervisor". O representante já entra pelo `ownerUserId` da
// empresa/do lead; aqui entra o supervisor dele.
//
// Vale pros dois caminhos de entrada, porque os dois passam por
// CompanyService#create: cadastro manual (o representante logado) e
// importação do Meta (que roda sob o contexto do gerente configurado em
// META_LEADS_DEFAULT_OWNER_USER_ID — regra 2; como ele é o topo da
// hierarquia comercial, não há supervisor a acrescentar e isto vira
// no-op).
//
// Silencioso de propósito: representante sem supervisor cadastrado
// continua criando prospect normalmente, só sem a segunda linha na
// equipe. Não é erro de cadastro de empresa.
export async function herdarSupervisor(
  tx: TenantTx,
  workspaceId: string,
  ownerUserId: string,
  companyId: string,
): Promise<void> {
  const dono = await tx.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ownerUserId } },
    select: { managerId: true },
  });
  if (!dono?.managerId) return;

  const supervisor = await tx.membership.findUnique({
    where: { id: dono.managerId },
    select: { userId: true, role: true, status: true, workspaceId: true },
  });
  if (
    !supervisor ||
    supervisor.workspaceId !== workspaceId ||
    supervisor.status !== 'active' ||
    supervisor.userId === ownerUserId ||
    temAcessoAutomatico(supervisor.role)
  ) {
    return;
  }

  await tx.companyAccess.upsert({
    where: { companyId_userId: { companyId, userId: supervisor.userId } },
    create: { workspaceId, companyId, userId: supervisor.userId },
    update: {},
  });
}
