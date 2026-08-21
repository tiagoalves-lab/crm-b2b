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
  // SupabaseUserService é a única porta pra identidade do membro (nome/
  // login/e-mail vivem em auth.users, não numa tabela nossa) — o módulo do
  // eGestor precisa dela pra casar vendedor do ERP com membro do CRM.
  exports: [SupabaseUserService],
})
export class MembershipModule {}
