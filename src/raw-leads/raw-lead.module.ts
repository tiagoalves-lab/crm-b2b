import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { CompanyModule } from '../companies/company.module';
import { MembershipModule } from '../memberships/membership.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { LeadScoringService } from './lead-scoring.service';
import { RawLeadController } from './raw-lead.controller';
import { RawLeadService } from './raw-lead.service';

@Module({
  // MembershipModule só pelo SupabaseUserService: a coluna
  // "Representante" da planilha casa nome/login/e-mail com o membro, e
  // essa identidade vive em auth.users, não numa tabela nossa.
  imports: [
    TenancyModule,
    PolicyModule,
    ActivityModule,
    CompanyModule,
    MembershipModule,
  ],
  controllers: [RawLeadController],
  providers: [RawLeadService, LeadScoringService],
  exports: [RawLeadService, LeadScoringService],
})
export class RawLeadModule {}
