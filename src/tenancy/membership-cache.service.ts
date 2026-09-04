import { Injectable } from '@nestjs/common';
import type { MembershipContext } from './tenant-membership.guard';

// Cache em memória do MembershipContext por usuário (2026-09-04, primeira
// etapa da performance). Antes, TODA requisição autenticada abria uma
// transação só pra reler o membership do usuário (BEGIN + 3 SET LOCAL +
// SELECT + COMMIT = 6 idas e voltas Virgínia↔Ohio, ~70 ms) antes de
// qualquer trabalho útil — e o CRM tem meia dúzia de usuários cujo papel
// muda uma vez por mês.
//
// Coerência: o backend roda numa instância só (Railway, sem réplica), e o
// único caminho que altera membership é MembershipService (update/remove),
// que invalida a entrada na hora. O TTL curto é o teto pra alteração feita
// por fora (SQL direto no Supabase) passar a valer. Falha de lookup nunca
// é cacheada — usuário sem cadastro continua batendo no banco e levando
// 403 (ver TenantMembershipGuard#ensureMembership).
const TTL_MS = 60_000;

interface Entry {
  value: MembershipContext;
  expiresAt: number;
}

@Injectable()
export class MembershipCacheService {
  private readonly entries = new Map<string, Entry>();

  get(userId: string): MembershipContext | undefined {
    const entry = this.entries.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(userId);
      return undefined;
    }
    return entry.value;
  }

  set(userId: string, value: MembershipContext): void {
    this.entries.set(userId, { value, expiresAt: Date.now() + TTL_MS });
  }

  invalidate(userId: string): void {
    this.entries.delete(userId);
  }

  clear(): void {
    this.entries.clear();
  }
}
