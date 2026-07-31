import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { ActivityQueryService } from './activity-query.service';
import { ActivityService } from './activity.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';

@Controller('activities')
export class ActivityController {
  constructor(
    private readonly activityQuery: ActivityQueryService,
    private readonly activities: ActivityService,
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

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateActivityDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId },
      (tx) => this.activities.createManual(tx, membership, dto),
    );
  }
}
