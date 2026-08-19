import { Module } from '@nestjs/common';
import { CompanyModule } from '../companies/company.module';
import { OpportunityModule } from '../opportunities/opportunity.module';
import { RawLeadModule } from '../raw-leads/raw-lead.module';
import { TaskModule } from '../tasks/task.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CountsController } from './counts.controller';
import { CountsService } from './counts.service';

@Module({
  imports: [
    TenancyModule,
    CompanyModule,
    OpportunityModule,
    TaskModule,
    RawLeadModule,
  ],
  controllers: [CountsController],
  providers: [CountsService],
})
export class CountsModule {}
