import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

  // Visibilidade de LEITURA de Company — mais larga que scopeFilter() e
  // que can() de propósito, e única fonte da regra: a lista de Empresas,
  // a ficha (CompanyService) e tudo que "pendura" numa empresa (Timeline
  // e nota da aba Timeline, em ActivityQueryService/ActivityService)
  // precisam responder a MESMA pergunta, senão a lista mostra uma empresa
  // que a ficha não consegue abrir — foi exatamente o bug de 2026-09-02:
  // manager via todas as empresas na lista (regra abaixo), mas a Timeline
  // ainda usava can(), que só conhece dono direto/hierarquia, e devolvia
  // 404 pra toda empresa sem dono (as vindas do eGestor), derrubando a
  // ficha inteira.
  //
  // Hierarquia de níveis, ver docs/arquitetura-dados.md §4a: níveis 1-3
  // (owner/admin/manager) sem filtro (`{}`) — veem todas as empresas do
  // workspace. `manager` é tratado igual a owner/admin AQUI de propósito
  // (pedido do usuário, 2026-08-13): em todo o resto do sistema
  // (oportunidades, tarefas, leads, contatos) `manager` continua restrito
  // à própria equipe via scopeFilter() — não generalizar esse bypass pra
  // lá sem pedido explícito. Nível 4 (sales_rep/readonly) mantém a lógica
  // antiga: dono direto OU oportunidade própria OU CompanyAccess (empresa
  // compartilhada, 2026-08-06), dentro da própria hierarquia.
  async companyReadFilter(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<Prisma.CompanyWhereInput> {
    if (membership.role === 'manager') {
      return {};
    }
    const scope = await this.scopeFilter(tx, membership);
    if (scope.ownerUserId === undefined) {
      return {};
    }
    const ownerCondition = scope.ownerUserId;
    const userIds =
      typeof ownerCondition === 'string' ? [ownerCondition] : ownerCondition.in;
    return {
      OR: [
        { ownerUserId: ownerCondition },
        { opportunities: { some: { ownerUserId: ownerCondition } } },
        { accessGrants: { some: { userId: { in: userIds } } } },
      ],
    };
  }

  // Versão pontual de companyReadFilter() pra quem já tem o id da Company
  // na mão (ficha, timeline, nota): mesma regra, mesma resposta que a
  // lista. Quem chama traduz `false` em 404 (não 403) — não confirma pra
  // quem não enxerga a empresa que ela existe (docs/seguranca.md, decisão
  // 4.2).
  async canReadCompany(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
  ): Promise<boolean> {
    if (!this.canModule(membership, 'empresas_cadastro', 'ver')) {
      return false;
    }
    const filter = await this.companyReadFilter(tx, membership);
    if (Object.keys(filter).length === 0) {
      return true;
    }
    const visible = await tx.company.findFirst({
      where: { id: companyId, workspaceId: membership.workspaceId, ...filter },
      select: { id: true },
    });
    return visible !== null;
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
