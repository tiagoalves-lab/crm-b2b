import { Module } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ActivityController } from './activity.controller';
import { ActivityQueryService } from './activity-query.service';
import { ActivityService } from './activity.service';

@Module({
  imports: [TenancyModule, PolicyModule],
  controllers: [ActivityController],
  providers: [ActivityService, ActivityQueryService],
  exports: [ActivityService],
})
export class ActivityModule {}
