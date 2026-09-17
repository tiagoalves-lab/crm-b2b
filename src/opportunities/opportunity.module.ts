import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { NotificationModule } from '../notifications/notification.module';
import { PolicyModule } from '../policy/policy.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OpportunityAttachmentController } from './opportunity-attachment.controller';
import { OpportunityAttachmentService } from './opportunity-attachment.service';
import {
  OpportunityCommentController,
  OpportunityCommentFeedController,
} from './opportunity-comment.controller';
import { OpportunityCommentService } from './opportunity-comment.service';
import { OpportunityItemController } from './opportunity-item.controller';
import { OpportunityItemService } from './opportunity-item.service';
import { OpportunityLostReasonController } from './opportunity-lost-reason.controller';
import { OpportunityLostReasonService } from './opportunity-lost-reason.service';
import { OpportunityController } from './opportunity.controller';
import { OpportunityService } from './opportunity.service';

@Module({
  imports: [
    TenancyModule,
    PolicyModule,
    ActivityModule,
    StorageModule,
    NotificationModule,
  ],
  controllers: [
    OpportunityController,
    OpportunityCommentController,
    OpportunityCommentFeedController,
    OpportunityAttachmentController,
    OpportunityItemController,
    OpportunityLostReasonController,
  ],
  providers: [
    OpportunityService,
    OpportunityCommentService,
    OpportunityAttachmentService,
    OpportunityItemService,
    OpportunityLostReasonService,
  ],
  // Idem TaskModule: exportado pro CountsService (src/counts/).
  exports: [OpportunityService],
})
export class OpportunityModule {}
