import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TenantContext {
  userId: string;
  workspaceId: string;
}

export type TenantTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Generaliza o helper `withWorkspace()` de test/rls-isolation.e2e-spec.ts
 * pra uso em request real: abre uma transação, seta as variáveis de sessão
 * que as policies de RLS leem (`app.current_workspace_id`) e que ficam
 * disponíveis pra auditoria/regras futuras (`app.current_user_id`), roda
 * `fn` dentro dela.
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    assertUuid(ctx.userId, 'userId');
    assertUuid(ctx.workspaceId, 'workspaceId');

    return this.prisma.$transaction(async (tx) => {
      // Postgres não aceita bind parameter no valor de SET LOCAL — os ids
      // já foram validados como UUID estrito acima (assertUuid), então a
      // interpolação abaixo nunca carrega texto arbitrário de request.
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_user_id = '${ctx.userId}'`,
      );
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_workspace_id = '${ctx.workspaceId}'`,
      );
      return fn(tx);
    });
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${field} inválido: esperado UUID, recebido "${value}".`);
  }
}
