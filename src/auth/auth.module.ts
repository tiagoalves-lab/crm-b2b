import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard';

@Module({
  // SupabaseAuthGuard também registrado sob seu próprio token (não só via
  // APP_GUARD/useClass) — necessário pra `overrideGuard(SupabaseAuthGuard)`
  // conseguir substituí-lo nos testes e2e (ver test/utils/fake-auth.ts).
  // useExisting evita criar uma segunda instância do guard.
  providers: [
    SupabaseAuthGuard,
    { provide: APP_GUARD, useExisting: SupabaseAuthGuard },
  ],
})
export class AuthModule {}
