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
// pra clientes externos. Só existe um workspace; todo login válido entra
// automaticamente nele, sem tela de "criar workspace" nem convite por
// token (isso fica pra uma rodada futura, se algum dia for preciso separar
// por área/filial — o modelo Workspace/Membership já suporta isso).
const DEFAULT_WORKSPACE_SLUG = 'gama';
const DEFAULT_WORKSPACE_NAME = 'Gama Brasil';
const DEFAULT_ROLE: MembershipRole = 'sales_rep';

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
    // Não usa mais upsert simples — precisa decidir o papel do primeiro
    // membro (owner) antes de criar, então checa existência primeiro. Se
    // já existir, devolve como está — não queremos rebaixar alguém que um
    // admin promoveu manualmente de volta pra sales_rep a cada novo login.
    const existing = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (existing) {
      return this.toMembershipContext(existing);
    }

    // Primeiro membro do workspace vira owner — sem isso ninguém consegue
    // promover ninguém (todo login novo cairia em sales_rep pra sempre, e
    // não existe outro jeito de virar owner além de mexer direto no banco).
    const memberCount = await tx.membership.count({ where: { workspaceId } });
    const role: MembershipRole = memberCount === 0 ? 'owner' : DEFAULT_ROLE;

    try {
      const created = await tx.membership.create({
        data: {
          workspaceId,
          userId,
          role,
          status: 'active',
          joinedAt: new Date(),
        },
      });
      return this.toMembershipContext(created);
    } catch {
      // Corrida rara: duas requests do mesmo usuário criando ao mesmo
      // tempo (ex.: dois cliques de login quase simultâneos). Quem perdeu
      // a corrida do unique constraint busca o que a outra já criou.
      const raced = await tx.membership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      return this.toMembershipContext(raced);
    }
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
