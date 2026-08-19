import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TaskComment } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateCommentDto } from './dto/create-comment.dto';
import { TaskService } from './task.service';

@Injectable()
export class TaskCommentService {
  constructor(
    private readonly tasks: TaskService,
    private readonly policy: PolicyService,
  ) {}

  // Comentar exige só "read" (não "write") — um gerente que enxerga a
  // tarefa de um subordinado (via PolicyService/hierarquia) precisa poder
  // comentar sem precisar ser o assignee, igual num board colaborativo.
  async create(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    dto: CreateCommentDto,
  ): Promise<TaskComment> {
    await this.tasks.mustBeVisible(tx, membership, taskId, 'read');

    return tx.taskComment.create({
      data: { taskId, authorUserId: membership.userId, body: dto.body },
    });
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    commentId: string,
  ): Promise<void> {
    // Checagem de papel antes de tudo (nega cedo, mesmo critério de
    // MembershipService/PipelineService) — representante não remove nem o
    // próprio comentário, mais restrito que "só o autor remove" abaixo.
    this.policy.assertCanDelete(membership, 'tarefas');
    await this.tasks.mustBeVisible(tx, membership, taskId, 'read');
    const comment = await tx.taskComment.findFirst({
      where: { id: commentId, taskId },
    });
    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }
    if (comment.authorUserId !== membership.userId) {
      throw new ForbiddenException('Só o autor pode remover o comentário.');
    }
    await tx.taskComment.delete({ where: { id: commentId } });
  }
}
