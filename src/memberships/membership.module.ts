import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { SupabaseUserService } from './supabase-user.service';

@Module({
  imports: [TenancyModule],
  controllers: [MembershipController],
  providers: [MembershipService, SupabaseUserService],
})
export class MembershipModule {}
