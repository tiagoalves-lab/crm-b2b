import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OpportunityAttachmentController } from './opportunity-attachment.controller';
import { OpportunityAttachmentService } from './opportunity-attachment.service';
import { OpportunityCommentController } from './opportunity-comment.controller';
import { OpportunityCommentService } from './opportunity-comment.service';
import { OpportunityItemController } from './opportunity-item.controller';
import { OpportunityItemService } from './opportunity-item.service';
import { OpportunityController } from './opportunity.controller';
import { OpportunityService } from './opportunity.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule, StorageModule],
  controllers: [
    OpportunityController,
    OpportunityCommentController,
    OpportunityAttachmentController,
    OpportunityItemController,
  ],
  providers: [
    OpportunityService,
    OpportunityCommentService,
    OpportunityAttachmentService,
    OpportunityItemService,
  ],
  // Idem TaskModule: exportado pro CountsService (src/counts/).
  exports: [OpportunityService],
})
export class OpportunityModule {}
