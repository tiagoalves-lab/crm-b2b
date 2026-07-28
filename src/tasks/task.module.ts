import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TaskChecklistController } from './task-checklist.controller';
import { TaskChecklistService } from './task-checklist.service';
import { TaskCommentController } from './task-comment.controller';
import { TaskCommentService } from './task-comment.service';
import { TaskListController } from './task-list.controller';
import { TaskListService } from './task-list.service';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule],
  controllers: [
    TaskController,
    TaskListController,
    TaskChecklistController,
    TaskCommentController,
  ],
  providers: [
    TaskService,
    TaskListService,
    TaskChecklistService,
    TaskCommentService,
  ],
})
export class TaskModule {}
