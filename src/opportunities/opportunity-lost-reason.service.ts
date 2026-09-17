import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MembershipRole, OpportunityLostReason } from '@prisma/client';
import { registrarExclusao } from '../deletion-log/registrar-exclusao';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

export const LOST_REASON_MAX = 120;

// Renomear e excluir é administração da lista (aba "Motivos de perda",
// 2026-09-17) — mesma régua das outras abas administrativas.
const PAPEIS_ADMIN = new Set<MembershipRole>(['owner', 'admin']);

export type LostReasonComUso = OpportunityLostReason & { usos: number };

// Lista de motivos de perda (2026-09-17) — ver o model
// OpportunityLostReason. Quem pode editar oportunidade pode cadastrar
// motivo novo: é quem marca a perda e precisa do motivo na hora.
@Injectable()
export class OpportunityLostReasonService {
  constructor(private readonly policy: PolicyService) {}

  // `usos` = quantas oportunidades carregam este motivo. A aba da
  // Administração mostra o número e só deixa excluir motivo sem uso.
  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<LostReasonComUso[]> {
    if (!this.policy.canModule(membership, 'oportunidades', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver oportunidades.');
    }
    const [motivos, usos] = await Promise.all([
      tx.opportunityLostReason.findMany({
        where: { workspaceId: membership.workspaceId },
      }),
      tx.opportunity.groupBy({
        by: ['lostReason'],
        where: { workspaceId: membership.workspaceId, lostReason: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const porNome = new Map(
      usos.map((u) => [u.lostReason ?? '', u._count._all] as const),
    );
    return motivos
      .map((m) => ({ ...m, usos: porNome.get(m.nome) ?? 0 }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    nomeDigitado: string,
  ): Promise<OpportunityLostReason> {
    if (!this.policy.canModule(membership, 'oportunidades', 'editar')) {
      throw new ForbiddenException('Sem permissão para editar oportunidades.');
    }
    const nome = this.normalizar(nomeDigitado);
    await this.garantirUnico(tx, membership, nome);
    return tx.opportunityLostReason.create({
      data: {
        workspaceId: membership.workspaceId,
        nome,
        criadoPor: membership.userId,
      },
    });
  }

  // Renomear leva junto as oportunidades já perdidas com o nome antigo:
  // é o mesmo motivo, e o Pareto não pode partir em duas barras.
  async rename(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    nomeDigitado: string,
  ): Promise<OpportunityLostReason> {
    const motivo = await this.mustExist(tx, membership, id);
    this.assertAdmin(membership);
    const nome = this.normalizar(nomeDigitado);
    if (nome === motivo.nome) return motivo;
    await this.garantirUnico(tx, membership, nome, motivo.id);

    const atualizado = await tx.opportunityLostReason.update({
      where: { id: motivo.id },
      data: { nome },
    });
    await tx.opportunity.updateMany({
      where: { workspaceId: membership.workspaceId, lostReason: motivo.nome },
      data: { lostReason: nome },
    });
    return atualizado;
  }

  // Motivo já usado não sai: a oportunidade perdida ficaria com um texto
  // que não existe mais na lista. Pra juntar dois motivos, renomeia-se.
  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<void> {
    const motivo = await this.mustExist(tx, membership, id);
    this.assertAdmin(membership);
    const usos = await tx.opportunity.count({
      where: { workspaceId: membership.workspaceId, lostReason: motivo.nome },
    });
    if (usos > 0) {
      throw new BadRequestException(
        `"${motivo.nome}" já foi usado em ${usos} oportunidade(s) e não pode ser excluído.`,
      );
    }
    await registrarExclusao(tx, membership, {
      entidade: 'motivo_perda',
      registroId: motivo.id,
      titulo: motivo.nome,
      snapshot: motivo,
    });
    await tx.opportunityLostReason.delete({ where: { id: motivo.id } });
  }

  // 404 antes de 403 (regra do projeto): quem não é admin não descobre
  // se o id existe.
  private async mustExist(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<OpportunityLostReason> {
    const motivo = await tx.opportunityLostReason.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!motivo) throw new NotFoundException('Motivo não encontrado.');
    return motivo;
  }

  private assertAdmin(membership: MembershipContext): void {
    if (!PAPEIS_ADMIN.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem alterar a lista de motivos.',
      );
    }
  }

  // Espaços repetidos colapsados — "Preço  alto" e "Preço alto" são o
  // mesmo motivo no Pareto.
  private normalizar(nomeDigitado: string): string {
    const nome = nomeDigitado.trim().replace(/\s+/g, ' ');
    if (!nome) {
      throw new BadRequestException('Digite o motivo.');
    }
    return nome;
  }

  private async garantirUnico(
    tx: TenantTx,
    membership: MembershipContext,
    nome: string,
    ignorarId?: string,
  ): Promise<void> {
    const existente = await tx.opportunityLostReason.findFirst({
      where: {
        workspaceId: membership.workspaceId,
        nome: { equals: nome, mode: 'insensitive' },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
    });
    if (existente) {
      throw new BadRequestException(`"${existente.nome}" já está na lista.`);
    }
  }
}
