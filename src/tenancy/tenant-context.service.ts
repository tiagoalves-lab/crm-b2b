import { Injectable } from '@nestjs/common';
import type { MembershipRole, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[a-z_]+$/;

export interface TenantContext {
  userId: string;
  workspaceId: string;
  // Opcional só pra não quebrar chamadas que ainda não têm um
  // MembershipContext à mão (ex.: TenantMembershipGuard resolvendo o
  // próprio membership antes dele existir). Todo controller de recurso
  // já passa `membership.role` — ver SPEC-CRM-GAMA.md §7.5.
  role?: MembershipRole;
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

  run<T>(
    ctx: TenantContext,
    fn: (tx: TenantTx) => Promise<T>,
    // Opcional — omitido, usa o timeout default do Prisma (5000ms), bom o
    // bastante pra toda operação normal (CRUD de um registro por vez).
    // Existe só pra endpoints que legitimamente fazem várias idas ao banco
    // numa única chamada (ex.: import de planilha linha a linha) — sem
    // isso, `$transaction` mata a transação com P2028 ("Transaction
    // already closed") antes do trabalho terminar, mesmo sem nenhum erro
    // de negócio (achado depurando um 500 real em
    // POST /raw-leads/import-contacts, 2026-08-06).
    options?: { timeoutMs?: number },
  ): Promise<T> {
    assertUuid(ctx.userId, 'userId');
    assertUuid(ctx.workspaceId, 'workspaceId');
    if (ctx.role !== undefined && !ROLE_RE.test(ctx.role)) {
      throw new Error(`role inválido: "${ctx.role}".`);
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Postgres não aceita bind parameter no valor de SET LOCAL — os ids
        // já foram validados como UUID estrito acima (assertUuid) e o role
        // contra um enum fechado (ROLE_RE), então a interpolação abaixo
        // nunca carrega texto arbitrário de request.
        await tx.$executeRawUnsafe(
          `SET LOCAL app.current_user_id = '${ctx.userId}'`,
        );
        await tx.$executeRawUnsafe(
          `SET LOCAL app.current_workspace_id = '${ctx.workspaceId}'`,
        );
        // Sempre seta (mesmo vazio) — SET LOCAL sem isso manteria o valor
        // da transação anterior no mesmo pool de conexão (Postgres reseta
        // no COMMIT/ROLLBACK, então isso não vaza entre requests, mas fica
        // explícito de qualquer jeito: nunca herdar role de ninguém).
        // "current_role" é palavra reservada do SQL (função CURRENT_ROLE) —
        // mesmo qualificado com o namespace "app.", o parser do comando SET
        // recusa o identificador desqualificado ("syntax error at or near
        // current_role"). Envolver "app.current_role" inteiro em aspas
        // duplas trata como um único identificador quotado, contornando a
        // palavra reservada — current_setting('app.current_role', true) nas
        // policies de RLS não muda (ali o nome é string, não identificador).
        await tx.$executeRawUnsafe(
          `SET LOCAL "app.current_role" = '${ctx.role ?? ''}'`,
        );
        return fn(tx);
      },
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
    );
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${field} inválido: esperado UUID, recebido "${value}".`);
  }
}
