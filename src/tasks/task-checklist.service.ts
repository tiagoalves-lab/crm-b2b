import { Injectable, NotFoundException } from '@nestjs/common';
import type { TaskChecklistItem } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import type { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { TaskService } from './task.service';

@Injectable()
export class TaskChecklistService {
  constructor(private readonly tasks: TaskService) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    dto: CreateChecklistItemDto,
  ): Promise<TaskChecklistItem> {
    await this.tasks.mustBeVisible(tx, membership, taskId, 'write');

    const last = await tx.taskChecklistItem.findFirst({
      where: { taskId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return tx.taskChecklistItem.create({
      data: { taskId, text: dto.text, position: (last?.position ?? -1) + 1 },
    });
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
  ): Promise<TaskChecklistItem> {
    await this.tasks.mustBeVisible(tx, membership, taskId, 'write');
    await this.mustExist(tx, taskId, itemId);

    return tx.taskChecklistItem.update({
      where: { id: itemId },
      data: { text: dto.text, done: dto.done, position: dto.position },
    });
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    taskId: string,
    itemId: string,
  ): Promise<void> {
    await this.tasks.mustBeVisible(tx, membership, taskId, 'delete');
    await this.mustExist(tx, taskId, itemId);
    await tx.taskChecklistItem.delete({ where: { id: itemId } });
  }

  private async mustExist(
    tx: TenantTx,
    taskId: string,
    itemId: string,
  ): Promise<TaskChecklistItem> {
    const item = await tx.taskChecklistItem.findFirst({
      where: { id: itemId, taskId },
    });
    if (!item) {
      throw new NotFoundException('Item de checklist não encontrado.');
    }
    return item;
  }
}
