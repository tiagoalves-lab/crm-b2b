import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OpportunityItem } from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateItemDto } from './dto/create-item.dto';
import type { UpdateItemDto } from './dto/update-item.dto';
import { ITEMS_MAX, normalizeItemName } from './opportunity-tags';
import { OpportunityService } from './opportunity.service';
import { nomeDaEmpresa, registrarExclusao } from '../deletion-log/registrar-exclusao';

// Lista lateral de itens do card de Oportunidade (2026-09-04) — ver
// opportunity-tags.ts pra regra das tags que nascem daqui.
//
// Cada item pode ter valor, e quando pelo menos um tem, a soma passa a
// ser o valor da oportunidade (sincronizarValor) — foi pra isso que o
// campo nasceu: o usuário orça item a item e quer o total no card.
@Injectable()
export class OpportunityItemService {
  constructor(
    private readonly opportunities: OpportunityService,
    private readonly activities: ActivityService,
  ) {}

  // Mexer na lista de itens é edição do card e entra no histórico
  // (2026-09-14) — sem isso o relatório mostraria o valor da
  // oportunidade mudando sozinho, já que a soma dos itens é que manda.
  private registrar(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload,
      opportunityId,
    });
  }

  // Mexer na lista exige "write" na oportunidade (quem pode editar o
  // negócio define o que está sendo negociado) — diferente do comentário,
  // que é colaborativo e exige só "read".
  async create(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    dto: CreateItemDto,
  ): Promise<OpportunityItem> {
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'write',
    );

    const name = normalizeItemName(dto.name);
    if (!name) {
      throw new BadRequestException('Digite o nome do item.');
    }
    const duplicate = await tx.opportunityItem.findFirst({
      where: { opportunityId, name: { equals: name, mode: 'insensitive' } },
    });
    if (duplicate) {
      throw new BadRequestException(`"${duplicate.name}" já está na lista.`);
    }
    const total = await tx.opportunityItem.count({ where: { opportunityId } });
    if (total >= ITEMS_MAX) {
      throw new BadRequestException(
        `A lista aceita no máximo ${ITEMS_MAX} itens.`,
      );
    }
    const last = await tx.opportunityItem.aggregate({
      where: { opportunityId },
      _max: { position: true },
    });

    const item = await tx.opportunityItem.create({
      data: {
        opportunityId,
        name,
        amount: dto.amount ?? null,
        position: (last._max.position ?? 0) + 1,
      },
    });
    await this.sincronizarValor(tx, opportunityId);
    await this.registrar(tx, membership, opportunityId, {
      action: 'item_added',
      item: item.name,
      to: item.amount === null ? null : String(item.amount),
    });
    return item;
  }

  // Edição de um item já cadastrado — na prática, digitar o valor
  // depois de montar a lista.
  async update(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<OpportunityItem> {
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'write',
    );
    const existing = await tx.opportunityItem.findFirst({
      where: { id: itemId, opportunityId },
    });
    if (!existing) {
      throw new NotFoundException('Item não encontrado.');
    }

    let name: string | undefined;
    if (dto.name !== undefined) {
      name = normalizeItemName(dto.name);
      if (!name) {
        throw new BadRequestException('Digite o nome do item.');
      }
      const duplicate = await tx.opportunityItem.findFirst({
        where: {
          opportunityId,
          name: { equals: name, mode: 'insensitive' },
          id: { not: existing.id },
        },
      });
      if (duplicate) {
        throw new BadRequestException(`"${duplicate.name}" já está na lista.`);
      }
    }

    const item = await tx.opportunityItem.update({
      where: { id: existing.id },
      data: {
        name,
        amount: dto.amount === undefined ? undefined : dto.amount,
      },
    });
    await this.sincronizarValor(tx, opportunityId);
    await this.registrar(tx, membership, opportunityId, {
      action: 'item_updated',
      item: item.name,
      nomeAnterior: existing.name === item.name ? undefined : existing.name,
      from: existing.amount === null ? null : String(existing.amount),
      to: item.amount === null ? null : String(item.amount),
    });
    return item;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    itemId: string,
  ): Promise<void> {
    const opportunity = await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'write',
    );
    const item = await tx.opportunityItem.findFirst({
      where: { id: itemId, opportunityId },
    });
    if (!item) {
      throw new NotFoundException('Item não encontrado.');
    }
    await registrarExclusao(tx, membership, {
      entidade: 'oportunidade_item',
      registroId: item.id,
      titulo: item.name,
      contexto: await nomeDaEmpresa(tx, opportunity.companyId),
      snapshot: item,
    });
    await tx.opportunityItem.delete({ where: { id: item.id } });
    await this.sincronizarValor(tx, opportunityId);
    await this.registrar(tx, membership, opportunityId, {
      action: 'item_removed',
      item: item.name,
      from: item.amount === null ? null : String(item.amount),
    });
  }

  // Soma dos itens vira o valor da oportunidade. Só quando algum item
  // tem valor: lista inteira sem preço (o uso original, item como
  // rótulo) deixa o valor do card como o usuário digitou.
  //
  // De propósito NÃO incrementa `version`: o card aberto no navegador
  // guarda a versão que leu e a ecoa no próximo "Salvar" (concorrência
  // otimista do OpportunityService). Mexer na versão aqui faria toda
  // digitação de valor derrubar o Salvar seguinte com erro de conflito.
  private async sincronizarValor(
    tx: TenantTx,
    opportunityId: string,
  ): Promise<void> {
    const soma = await tx.opportunityItem.aggregate({
      where: { opportunityId },
      _sum: { amount: true },
    });
    const total = soma._sum.amount;
    if (total === null || total === undefined) return;
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { amount: total },
    });
  }
}
