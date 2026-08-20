import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole, MembershipStatus, Prisma } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import type { AuthenticatedRequest } from '../auth/supabase-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService, type TenantTx } from './tenant-context.service';

// Ferramenta interna de uso colaborativo da Gama — não é SaaS multi-tenant
// pra clientes externos. Só existe um workspace. Acesso exige cadastro
// prévio: um login válido do Supabase Auth SÓ entra se um gestor já o
// cadastrou (POST /memberships). A única exceção é o bootstrap do
// primeiríssimo login de um workspace vazio (vira owner), que em produção
// já ocorreu e nunca mais dispara. Antes da auditoria de 2026-08-20,
// qualquer login válido era promovido a sales_rep automaticamente — o que
// transformava "ter conta no Supabase" em "ser funcionário da Gama". Ver
// docs/seguranca.md, seção 0 (cenário B).
const DEFAULT_WORKSPACE_SLUG = 'gama';
const DEFAULT_WORKSPACE_NAME = 'Gama Brasil';

export interface MembershipContext {
  id: string;
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  // Matriz granular de permission-catalog.ts, guardada como Json cru
  // (mesmo tipo que a coluna do Prisma) — tipada largo de propósito aqui
  // pra qualquer row de Membership vinda direto do Prisma (produção,
  // fixture de teste, e2e) ser atribuível sem cast. Opcional (tests
  // frequentemente montam um MembershipContext à mão sem se importar com
  // isto). Quem interpreta o shape é só PolicyService.canModule, via
  // resolvePermission — narrowing pra PermissionMatrix acontece lá, no
  // único ponto que realmente lê o conteúdo.
  permissions?: Prisma.JsonValue | null;
}

export type MembershipRequest = AuthenticatedRequest & {
  membership: MembershipContext;
};

@Injectable()
export class TenantMembershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<MembershipRequest>();

    const workspace = await this.resolveDefaultWorkspace();
    const membership = await this.tenantContext.run(
      { userId: request.user.id, workspaceId: workspace.id },
      (tx) => this.ensureMembership(tx, workspace.id, request.user.id),
    );

    if (membership.status === 'suspended') {
      throw new ForbiddenException('Acesso suspenso para este usuário.');
    }

    request.membership = membership;
    return true;
  }

  private resolveDefaultWorkspace(): Promise<{ id: string }> {
    // `workspaces` é a única tabela sem RLS (decisão da Fase 1 — ver
    // docs/arquitetura-dados.md) — upsert por slug fixo é atômico
    // (ON CONFLICT) e seguro de chamar fora de qualquer contexto de tenant.
    return this.prisma.workspace.upsert({
      where: { slug: DEFAULT_WORKSPACE_SLUG },
      update: {},
      create: { slug: DEFAULT_WORKSPACE_SLUG, name: DEFAULT_WORKSPACE_NAME },
      select: { id: true },
    });
  }

  private async ensureMembership(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
  ): Promise<MembershipContext> {
    // Já tem cadastro: devolve como está — não queremos rebaixar alguém
    // que um admin promoveu manualmente de volta pra sales_rep a cada novo
    // login.
    const existing = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (existing) {
      return this.toMembershipContext(existing);
    }

    // Bootstrap: SÓ o primeiro login de um workspace vazio vira owner
    // automaticamente — sem isso ninguém conseguiria virar owner sem mexer
    // direto no banco. Em produção o workspace já tem membros, então este
    // ramo nunca mais dispara aqui; ele protege só ambiente novo/local/de
    // teste.
    const memberCount = await tx.membership.count({ where: { workspaceId } });
    if (memberCount === 0) {
      try {
        const created = await tx.membership.create({
          data: {
            workspaceId,
            userId,
            role: 'owner',
            status: 'active',
            joinedAt: new Date(),
          },
        });
        return this.toMembershipContext(created);
      } catch {
        // Corrida rara: dois cliques de login quase simultâneos no
        // bootstrap. Quem perdeu a corrida do unique constraint busca o
        // que a outra já criou.
        const raced = await tx.membership.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId, userId } },
        });
        return this.toMembershipContext(raced);
      }
    }

    // Workspace já tem membros e este login não tem cadastro: NEGA. Esta
    // linha era, antes, a criação automática de um sales_rep pra qualquer
    // login válido — a porta que a auditoria de 2026-08-20 fechou. Acesso
    // agora exige cadastro prévio feito por um gestor.
    throw new ForbiddenException(
      'Seu login não tem acesso a este sistema. Peça a um gestor para cadastrá-lo.',
    );
  }

  private toMembershipContext(row: {
    id: string;
    workspaceId: string;
    userId: string;
    role: MembershipRole;
    status: MembershipStatus;
    permissions: Prisma.JsonValue | null;
  }): MembershipContext {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role,
      status: row.status,
      permissions: row.permissions,
    };
  }
}
