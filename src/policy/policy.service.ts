import { Injectable } from '@nestjs/common';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { OwnedResource, PolicyAction } from './policy.types';

export type OwnerScopeFilter = { ownerUserId?: string | { in: string[] } };

/**
 * Implementa o modelo de permissões de docs/arquitetura-dados.md, seção 4b:
 * RBAC por papel (Membership.role) combinado com ownership/hierarquia de
 * time. RLS no Postgres já garante a fronteira de workspace (Fase 1) — este
 * serviço resolve a segunda camada, ownership dentro do workspace.
 *
 * `readonly` não tem uma regra de visibilidade própria descrita no doc
 * ("leitura conforme mesma regra, sem edição") — interpretação adotada
 * aqui: mesma visibilidade de sales_rep (só os próprios registros), já que
 * é o papel mais restrito da lista.
 */
@Injectable()
export class PolicyService {
  async can(
    tx: TenantTx,
    membership: MembershipContext,
    action: PolicyAction,
    resource: OwnedResource,
  ): Promise<boolean> {
    if (membership.role === 'owner' || membership.role === 'admin') {
      return true;
    }
    if (membership.role === 'readonly' && action !== 'read') {
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
