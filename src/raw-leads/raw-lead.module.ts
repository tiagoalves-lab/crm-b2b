import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { CompanyModule } from '../companies/company.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { LeadScoringService } from './lead-scoring.service';
import { RawLeadController } from './raw-lead.controller';
import { RawLeadService } from './raw-lead.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule, CompanyModule],
  controllers: [RawLeadController],
  providers: [RawLeadService, LeadScoringService],
  exports: [RawLeadService, LeadScoringService],
})
export class RawLeadModule {}
