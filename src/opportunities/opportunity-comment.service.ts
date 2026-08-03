import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OpportunityComment } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateCommentDto } from './dto/create-comment.dto';
import { OpportunityService } from './opportunity.service';

// Mirror de src/tasks/task-comment.service.ts.
@Injectable()
export class OpportunityCommentService {
  constructor(private readonly opportunities: OpportunityService) {}

  // Comentar exige só "read" — mesmo raciocínio de TaskCommentService:
  // colaborativo, não só quem é dono da oportunidade.
  async create(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    dto: CreateCommentDto,
  ): Promise<OpportunityComment> {
    await this.opportunities.mustBeVisible(tx, membership, opportunityId, 'read');

    return tx.opportunityComment.create({
      data: { opportunityId, authorUserId: membership.userId, body: dto.body },
    });
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    commentId: string,
  ): Promise<void> {
    await this.opportunities.mustBeVisible(tx, membership, opportunityId, 'read');
    const comment = await tx.opportunityComment.findFirst({
      where: { id: commentId, opportunityId },
    });
    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }
    if (comment.authorUserId !== membership.userId) {
      throw new ForbiddenException('Só o autor pode remover o comentário.');
    }
    await tx.opportunityComment.delete({ where: { id: commentId } });
  }
}
