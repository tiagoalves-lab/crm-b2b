import { ForbiddenException, Injectable } from '@nestjs/common';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { TenantTx } from '../tenancy/tenant-context.service';
import {
  resolvePermission,
  toPermissionAction,
  type PermissionAction,
  type PermissionMatrix,
  type PermissionModule,
} from './permission-catalog';
import type { OwnedResource, PolicyAction } from './policy.types';

export type OwnerScopeFilter = { ownerUserId?: string | { in: string[] } };

/**
 * Implementa o modelo de permissões de docs/arquitetura-dados.md, seção 4b:
 * RBAC por papel (Membership.role) combinado com ownership/hierarquia de
 * time, MAIS a matriz granular de permission-catalog.ts (2026-08-12) — duas
 * dimensões separadas de propósito:
 *
 * - **Escopo** (quem enxerga o quê: próprio registro, equipe via
 *   managerId, ou todos) continua vindo do papel — RLS no Postgres já
 *   codifica isso em produção (ver prisma/schema.sql, policies
 *   "ws_and_role_select"), então não muda: reescrever essa camada seria
 *   mexer no RLS com dado real, fora do escopo desta mudança.
 * - **Capacidade** (pode tentar a ação, dado que o registro está no seu
 *   escopo) agora vem da matriz — canModule()/resolvePermission() — não
 *   mais de um binário fixo por papel.
 *
 * `readonly` não tem uma regra de visibilidade própria descrita no doc
 * ("leitura conforme mesma regra, sem edição") — interpretação adotada
 * aqui: mesma visibilidade de sales_rep (só os próprios registros), já que
 * é o papel mais restrito da lista.
 */
@Injectable()
export class PolicyService {
  // Síncrono, sem tx — só olha membership.role/membership.permissions
  // (já carregados no MembershipContext pelo TenantMembershipGuard), sem
  // round-trip novo no banco. owner/admin sempre true (bypass, nunca
  // consultam a matriz — ver comentário de classe).
  canModule(
    membership: MembershipContext,
    module: PermissionModule,
    action: PermissionAction,
  ): boolean {
    if (membership.role === 'owner' || membership.role === 'admin') {
      return true;
    }
    // membership.permissions é Prisma.JsonValue cru (ver MembershipContext)
    // — resolvePermission só acessa via optional chaining (matrix?.[m]?.[a]),
    // então mesmo um valor com shape inesperado (nunca deveria acontecer,
    // é sempre escrito por MembershipService#parsePermissionMatrix) resolve
    // pra undefined em vez de lançar, e cai no preset do papel.
    return resolvePermission(
      membership.role,
      membership.permissions as PermissionMatrix | null | undefined,
      module,
      action,
    );
  }

  async can(
    tx: TenantTx,
    membership: MembershipContext,
    action: PolicyAction,
    resource: OwnedResource,
    module: PermissionModule,
  ): Promise<boolean> {
    if (membership.role === 'owner' || membership.role === 'admin') {
      return true;
    }
    if (!this.canModule(membership, module, toPermissionAction(action))) {
      return false;
    }
    if (resource.ownerUserId === membership.userId) {
      return true;
    }
    if (membership.role === 'manager') {
      const subordinateIds = await this.getSubordinateUserIds(
        tx,
        membership.id,
      );
      return (
        resource.ownerUserId !== null &&
        subordinateIds.includes(resource.ownerUserId)
      );
    }
    return false;
  }

  // Bloqueio equivalente ao ramo 'excluir' de can() acima, mas pra
  // chamadores que não carregam um OwnedResource pronto
  // (TaskCommentService/TaskAttachmentService/OpportunityCommentService/
  // OpportunityAttachmentService resolvem "posso excluir" por autoria
  // própria — "só quem enviou/comentou remove" — não por ownerUserId de um
  // recurso pai). Lança direto (em vez de devolver boolean como can())
  // porque todo chamador ia só if(!ok) throw ForbiddenException mesmo,
  // igual ao restante do módulo.
  assertCanDelete(
    membership: MembershipContext,
    module: PermissionModule,
  ): void {
    if (!this.canModule(membership, module, 'excluir')) {
      throw new ForbiddenException('Sem permissão para excluir neste módulo.');
    }
  }

  async scopeFilter(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<OwnerScopeFilter> {
    if (membership.role === 'owner' || membership.role === 'admin') {
      return {};
    }
    if (membership.role === 'manager') {
      const subordinateIds = await this.getSubordinateUserIds(
        tx,
        membership.id,
      );
      return { ownerUserId: { in: [membership.userId, ...subordinateIds] } };
    }
    return { ownerUserId: membership.userId };
  }

  private async getSubordinateUserIds(
    tx: TenantTx,
    managerMembershipId: string,
  ): Promise<string[]> {
    const reports = await tx.membership.findMany({
      where: { managerId: managerMembershipId },
      select: { userId: true },
    });
    return reports.map((r) => r.userId);
  }
}
