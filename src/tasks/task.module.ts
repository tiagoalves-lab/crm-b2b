import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TaskAttachmentController } from './task-attachment.controller';
import { TaskAttachmentService } from './task-attachment.service';
import { TaskChecklistController } from './task-checklist.controller';
import { TaskChecklistService } from './task-checklist.service';
import { TaskCommentController } from './task-comment.controller';
import { TaskCommentService } from './task-comment.service';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule, StorageModule],
  controllers: [
    TaskController,
    TaskChecklistController,
    TaskCommentController,
    TaskAttachmentController,
  ],
  providers: [
    TaskService,
    TaskChecklistService,
    TaskCommentService,
    TaskAttachmentService,
  ],
  // TaskService sai do módulo pro CountsService reusar o findAll no badge
  // da barra lateral (ver src/counts/).
  exports: [TaskService],
})
export class TaskModule {}
