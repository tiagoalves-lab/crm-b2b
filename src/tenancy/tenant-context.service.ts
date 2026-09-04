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
        // Uma ida só ao banco pras três variáveis de sessão (2026-09-04).
        // Eram três SET LOCAL separados — três idas e voltas Virgínia↔Ohio
        // por transação, em toda requisição. set_config(nome, valor, true)
        // é o equivalente exato de SET LOCAL (vale até o fim da transação;
        // Postgres reseta no COMMIT/ROLLBACK, nada vaza entre requests no
        // pool) e aceita bind parameter, então a interpolação de string
        // de antes deixou de existir. As validações acima (UUID estrito,
        // enum de role) continuam como defesa em profundidade. O role é
        // sempre setado, mesmo vazio: nunca herdar role de ninguém.
        // current_setting('app.current_role', true) nas policies de RLS
        // lê exatamente o que está aqui (o nome é string nos dois lados).
        await tx.$queryRaw`SELECT
          set_config('app.current_user_id', ${ctx.userId}, true),
          set_config('app.current_workspace_id', ${ctx.workspaceId}, true),
          set_config('app.current_role', ${ctx.role ?? ''}, true)`;
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
