import { Module } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { SupabaseUserService } from './supabase-user.service';

@Module({
  imports: [TenancyModule, PolicyModule],
  controllers: [MembershipController],
  providers: [MembershipService, SupabaseUserService],
})
export class MembershipModule {}
