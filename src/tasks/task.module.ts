import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
