import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MembershipCacheService } from './membership-cache.service';
import { TenantContextService } from './tenant-context.service';
import { TenantMembershipGuard } from './tenant-membership.guard';

@Module({
  // Mesmo motivo do AuthModule: TenantMembershipGuard precisa de token
  // próprio pra `overrideGuard` conseguir substituí-lo nos testes e2e.
  providers: [
    TenantContextService,
    MembershipCacheService,
    TenantMembershipGuard,
    { provide: APP_GUARD, useExisting: TenantMembershipGuard },
  ],
  // MembershipCacheService exportado pra MembershipService invalidar a
  // entrada do usuário ao alterar/remover membro.
  exports: [TenantContextService, MembershipCacheService],
})
export class TenancyModule {}
