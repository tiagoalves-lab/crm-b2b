import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole, MembershipStatus } from '@prisma/client';
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

  private ensureMembership(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
  ): Promise<MembershipContext> {
    // update: {} preserva role/status se o Membership já existir — não
    // queremos rebaixar alguém que um admin promoveu manualmente de volta
    // pra sales_rep a cada novo login.
    return tx.membership.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      update: {},
      create: {
        workspaceId,
        userId,
        role: DEFAULT_ROLE,
        status: 'active',
        joinedAt: new Date(),
      },
    });
  }
}
