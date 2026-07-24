import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TenantContextService } from './tenant-context.service';
import { TenantMembershipGuard } from './tenant-membership.guard';

@Module({
  providers: [
    TenantContextService,
    { provide: APP_GUARD, useClass: TenantMembershipGuard },
  ],
  exports: [TenantContextService],
})
export class TenancyModule {}
