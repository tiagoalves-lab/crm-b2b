import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TenantContextService } from './tenant-context.service';
import { TenantMembershipGuard } from './tenant-membership.guard';

@Module({
  // Mesmo motivo do AuthModule: TenantMembershipGuard precisa de token
  // próprio pra `overrideGuard` conseguir substituí-lo nos testes e2e.
  providers: [
    TenantContextService,
    TenantMembershipGuard,
    { provide: APP_GUARD, useExisting: TenantMembershipGuard },
  ],
  exports: [TenantContextService],
})
export class TenancyModule {}
