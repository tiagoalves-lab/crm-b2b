import { Controller, Get, Query } from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { ActivityQueryService } from './activity-query.service';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';

@Controller('activities')
export class ActivityController {
  constructor(
    private readonly activityQuery: ActivityQueryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.activityQuery.findAll(tx, membership, query),
    );
  }
}
