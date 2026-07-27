import { BadRequestException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';

// Company/Contact/Task permitem atribuir owner/assignee diferente de quem
// chama — docs/arquitetura-dados.md exige isso pra Company
// ("owner_user_id deve ser um Membership ativo do mesmo workspace");
// estendido por consistência pros demais campos equivalentes.
export async function assertActiveMembership(
  tx: TenantTx,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const membership = await tx.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership || membership.status !== 'active') {
    throw new BadRequestException(
      `userId "${userId}" não é um membro ativo deste workspace.`,
    );
  }
}
