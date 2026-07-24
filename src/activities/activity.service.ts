import { Injectable } from '@nestjs/common';
import type { Activity, ActivityType, Prisma } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';

export interface EmitActivityInput {
  workspaceId: string;
  actorUserId: string | null;
  type: ActivityType;
  payload?: Record<string, unknown>;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
}

// Ponto único de escrita em Activity — todo resource service chama isso em
// vez de duplicar o insert. Sem endpoint HTTP próprio nesta fase: leitura
// de feed é Fase 4 (ver docs/roadmap.md).
@Injectable()
export class ActivityService {
  emit(tx: TenantTx, input: EmitActivityInput): Promise<Activity> {
    const targets = [
      input.companyId,
      input.contactId,
      input.opportunityId,
    ].filter((id): id is string => id !== undefined && id !== null);
    if (targets.length !== 1) {
      throw new Error(
        'ActivityService.emit exige exatamente um de companyId/contactId/opportunityId — erro de chamador, não de input de usuário.',
      );
    }

    return tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        type: input.type,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        companyId: input.companyId ?? undefined,
        contactId: input.contactId ?? undefined,
        opportunityId: input.opportunityId ?? undefined,
      },
    });
  }
}
