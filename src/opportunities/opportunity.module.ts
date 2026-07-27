import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OpportunityController } from './opportunity.controller';
import { OpportunityService } from './opportunity.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule],
  controllers: [OpportunityController],
  providers: [OpportunityService],
})
export class OpportunityModule {}
