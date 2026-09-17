import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { MembershipRole } from '@prisma/client';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { ENTIDADES_EXCLUIDAS } from './registrar-exclusao';

// Tela "Registro de exclusões" (Administração, 2026-09-16). Só owner/admin:
// a cópia guardada tem o conteúdo inteiro do que foi apagado (inclusive de
// carteira de outro representante), então ler aqui é ver tudo. O nav
// esconde o item dos demais papéis — defesa em profundidade, a regra é
// esta. Não existe rota de alterar nem de apagar registro: a tabela é só
// de inserção (ver a migration 20260916140000_deletion_log).
const PAPEIS_PERMITIDOS = new Set<MembershipRole>(['owner', 'admin']);

export class ListarExclusoesQuery {
  @IsOptional()
  @IsIn(ENTIDADES_EXCLUIDAS)
  entidade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

@Controller('exclusoes')
export class DeletionLogController {
  constructor(private readonly tenantContext: TenantContextService) {}

  @Get()
  async listar(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListarExclusoesQuery,
  ) {
    if (!PAPEIS_PERMITIDOS.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem ver o registro de exclusões.',
      );
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = {
      workspaceId: membership.workspaceId,
      ...(query.entidade ? { entidade: query.entidade } : {}),
    };

    const [total, registros] = await this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      async (tx) => [
        await tx.deletionLog.count({ where }),
        await tx.deletionLog.findMany({
          where,
          orderBy: { criadoEm: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ] as const,
    );

    return {
      total,
      page,
      pageSize,
      items: registros.map((r) => ({
        id: r.id,
        entidade: r.entidade,
        registroId: r.registroId,
        titulo: r.titulo,
        contexto: r.contexto,
        actorUserId: r.actorUserId,
        criadoEm: r.criadoEm,
        snapshot: r.snapshot,
      })),
    };
  }
}
