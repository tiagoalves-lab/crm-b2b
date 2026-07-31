import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Company } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// CRUD completo (listar/criar/descartar, score) fica pra Fatia 6
// (SPEC-CRM-GAMA.md §4.4) — este service nasce só com approve(), que o
// seletor de empresa do Pipeline (§4.2.1, caminho 2) já precisa.
@Injectable()
export class RawLeadService {
  // A company já existe desde a importação do lead (criada com a tag
  // "lead-triagem", ver §4.4) — aprovar não recria nada, só remove o
  // marcador de triagem + marca o lead como aprovado. Histórico
  // (activities/tasks já ligados a essa company) nunca migra.
  async approve(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    const lead = await tx.rawLead.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!lead) {
      throw new NotFoundException('Lead não encontrado.');
    }
    if (lead.status !== 'novo') {
      throw new BadRequestException('Lead já foi aprovado ou descartado.');
    }
    if (!lead.promotedCompanyId) {
      throw new BadRequestException(
        'Lead sem empresa associada — não pode ser aprovado.',
      );
    }

    const company = await tx.company.findFirst({
      where: { id: lead.promotedCompanyId, workspaceId: membership.workspaceId },
    });
    if (!company) {
      throw new NotFoundException('Empresa do lead não encontrada.');
    }

    await tx.rawLead.update({
      where: { id: lead.id },
      data: { status: 'aprovado' },
    });

    return tx.company.update({
      where: { id: company.id },
      data: { tags: company.tags.filter((t) => t !== 'lead-triagem') },
    });
  }
}
