import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Opportunity,
  OpportunityComment,
  OpportunityCommentEdit,
  OpportunityItem,
  OpportunityStatus,
  Prisma,
  Stage,
} from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import { assertActiveMembership } from '../common/assert-active-membership';
import { OptimisticConcurrencyException } from '../common/exceptions/optimistic-concurrency.exception';
import type { PaginatedResult } from '../companies/company.service';
import { PolicyService } from '../policy/policy.service';
import { garantirLeadConvertido } from '../raw-leads/lead-convertido-automatico';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateOpportunityDto } from './dto/create-opportunity.dto';
import type { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';
import type { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import {
  ehEtapaDeProposta,
  hojeComoData,
  type SlaTratamento,
} from './opportunity-sla';
import { uniqueItemNames } from './opportunity-tags';
import { COMPANY_REF_SELECT, type CompanyRef } from '../companies/company-ref';
import {
  nomeDaEmpresa,
  registrarExclusao,
} from '../deletion-log/registrar-exclusao';

// open -> won/lost (fechamento); won/lost -> open (reabertura explícita,
// limpa lostReason/closedAt). Bloqueia won<->lost direto — precisa reabrir
// primeiro. Interpretação minha de "estados terminais exigem reabertura
// explícita" (docs/arquitetura-dados.md fala de mudança de STAGE nesse
// contexto, não de status diretamente) — sinalizado aqui por ser uma
// extensão, não algo literal do doc.
// Item de GET /opportunities: a oportunidade + referência mínima da
// empresa, pro card do Pipeline/Painel rotular sem baixar a base inteira
// de empresas (2026-09-04, ver company-ref.ts). Resolvida numa segunda
// consulta na mesma transação — custa a mesma ida que um include, mas não
// depende de include em relação obrigatória: empresa invisível pelo RLS
// vira null em vez de erro de consistência do Prisma.
// `pendenciaParaMim` (2026-09-14): alguém destacou QUEM ESTÁ PEDINDO a
// lista num comentário deste card e ele ainda não deu baixa — o quadro
// acende o alerta "Pendência(s) para você". É sempre relativo a quem
// pergunta, nunca um estado global do card.
export type OpportunityListItem = Opportunity & {
  company: CompanyRef | null;
  pendenciaParaMim: boolean;
};

// Campos do card cuja edição entra no histórico (2026-09-14), com o
// valor anterior e o novo. `status`/`stageId` ficam de fora porque têm
// registro próprio (status_changed e stage_change).
const camposEditaveis = [
  'companyId',
  'ownerUserId',
  'amount',
  'currency',
  'expectedCloseDate',
  'description',
] as const satisfies readonly (keyof Opportunity)[];

// Valor gravado no histórico: texto simples, comparável. Decimal do
// Prisma e Date não sobrevivem a uma comparação direta (objetos), e o
// payload é JSON.
function valorParaHistorico(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

const ALLOWED_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  open: ['won', 'lost'],
  won: ['open'],
  lost: ['open'],
};

// Comentários do card (feature nova, ver OpportunityCommentService) e a
// lista lateral de itens (OpportunityItemService, 2026-09-04) — embutidos
// em findOne, mesmo padrão de TaskWithDetails. Anexos ficam de fora
// (endpoint próprio), igual Task.
//
// Cada comentário traz junto as versões anteriores do texto (edição com
// histórico, 2026-10-16) — poucas linhas por card, e a ficha mostra o
// histórico no clique sem outra ida ao servidor.
export type OpportunityWithDetails = Opportunity & {
  comments: Array<OpportunityComment & { edits: OpportunityCommentEdit[] }>;
  items: OpportunityItem[];
};

@Injectable()
export class OpportunityService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateOpportunityDto,
  ): Promise<Opportunity> {
    if (!this.policy.canModule(membership, 'oportunidades', 'criar')) {
      throw new ForbiddenException(
        'Sem permissão para cadastrar oportunidades.',
      );
    }

    const ownerUserId = dto.ownerUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, ownerUserId);
    await this.mustCompanyExist(tx, membership.workspaceId, dto.companyId);
    const stage = await this.mustStageBelongToPipeline(
      tx,
      membership.workspaceId,
      dto.pipelineId,
      dto.stageId,
    );

    const opportunity = await tx.opportunity.create({
      data: {
        workspaceId: membership.workspaceId,
        companyId: dto.companyId,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        ownerUserId,
        amount: dto.amount,
        currency: dto.currency,
        expectedCloseDate: dto.expectedCloseDate
          ? new Date(dto.expectedCloseDate)
          : undefined,
        // SLA automático (opportunity-sla.ts): nasce pendente numa etapa
        // de proposta; cadastrada direto em Negociação, já nasce fechado.
        slaDueDate: ehEtapaDeProposta(stage) ? null : hojeComoData(),
        description: dto.description,
        status: 'open',
      },
    });

    // Lista lateral de itens digitada já no cadastro (2026-09-04) — na
    // mesma transação, na ordem em que o usuário digitou.
    const items = uniqueItemNames(dto.items ?? []);
    if (items.length > 0) {
      await tx.opportunityItem.createMany({
        data: items.map((name, index) => ({
          opportunityId: opportunity.id,
          name,
          position: index + 1,
        })),
      });
    }

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'created' },
      opportunityId: opportunity.id,
    });

    // Empresa que nunca passou pela Prospecção ganha o lead convertido que
    // falta — senão some da Carteira e do Funil (G8 Brindes, 2026-09-28).
    await garantirLeadConvertido(
      tx,
      membership.workspaceId,
      dto.companyId,
      ownerUserId,
      { actorUserId: membership.userId, origem: 'oportunidade' },
    );

    return opportunity;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListOpportunitiesQueryDto,
  ): Promise<PaginatedResult<OpportunityListItem>> {
    // Mesmo critério de TaskService#findAll: filtrado por empresa (aba
    // "Oportunidades" da ficha) usa empresas_oportunidades, separado da
    // tela geral (Pipeline) — só 'ver' tem efeito próprio, ver comentário
    // lá.
    const viewModule = query.companyId
      ? 'empresas_oportunidades'
      : 'oportunidades';
    if (!this.policy.canModule(membership, viewModule, 'ver')) {
      throw new ForbiddenException('Sem permissão para ver oportunidades.');
    }
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OpportunityWhereInput = {
      workspaceId: membership.workspaceId,
      ...ownerFilter,
      deletedAt: query.includeDeleted ? undefined : null,
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    if (query.staleDays) {
      where.id = {
        in: await this.findStaleOpportunityIds(
          tx,
          membership.workspaceId,
          query.staleDays,
        ),
      };
    }

    const [rows, total] = await Promise.all([
      tx.opportunity.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Ordem escolhida à mão no quadro primeiro (2026-09-14); quem
        // nunca foi arrastado (position NULL) fica depois, na ordem de
        // sempre — mais recente primeiro.
        orderBy: [
          { position: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
      }),
      tx.opportunity.count({ where }),
    ]);

    const companyIds = [...new Set(rows.map((o) => o.companyId))];
    const companies =
      companyIds.length > 0
        ? await tx.company.findMany({
            where: { id: { in: companyIds } },
            select: COMPANY_REF_SELECT,
          })
        : [];
    const companyById = new Map(companies.map((c) => [c.id, c]));

    // Pendência para quem está olhando (2026-09-14): existe comentário
    // neste card que destacou este usuário e em que ele ainda não deu
    // baixa. Uma consulta só pra página inteira — é o que acende o
    // triângulo amarelo no card do quadro.
    const comDestaque =
      rows.length > 0
        ? await tx.opportunityComment.findMany({
            where: {
              opportunityId: { in: rows.map((o) => o.id) },
              mentionedUserIds: { has: membership.userId },
              NOT: { mentionsDoneUserIds: { has: membership.userId } },
            },
            select: { opportunityId: true },
            distinct: ['opportunityId'],
          })
        : [];
    const pendentes = new Set(comDestaque.map((c) => c.opportunityId));

    const items = rows.map((o) => ({
      ...o,
      company: companyById.get(o.companyId) ?? null,
      pendenciaParaMim: pendentes.has(o.id),
    }));

    return { items, total, page, pageSize };
  }

  // "Deal parado" (Fase 4, docs/roadmap.md): open, sem stage_change (ou
  // criação, se nunca mudou de stage) há pelo menos staleDays. IDs
  // resolvidos via SQL raw (parametrizado via tagged template — nunca
  // interpolação de string) e depois aplicados como filtro comum do
  // Prisma, pra reusar scopeFilter/paginação/deletedAt sem duplicar essa
  // lógica em SQL.
  private async findStaleOpportunityIds(
    tx: TenantTx,
    workspaceId: string,
    staleDays: number,
  ): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM "opportunities" o
      WHERE o."workspace_id" = ${workspaceId}::uuid
        AND o."status" = 'open'
        AND o."deleted_at" IS NULL
        AND COALESCE(
          (SELECT MAX(a."occurred_at") FROM "activities" a
           WHERE a."opportunity_id" = o."id" AND a."type" = 'stage_change'),
          o."created_at"
        ) < NOW() - (${staleDays} || ' days')::interval
    `;
    return rows.map((r) => r.id);
  }

  // Ordem dos cards dentro de uma coluna do quadro (2026-09-14). O
  // frontend manda a coluna inteira na ordem que ficou depois do arrasto e
  // cada card recebe a posição pelo índice — sem cálculo de "meio termo"
  // entre dois vizinhos, que é onde esse tipo de recurso costuma criar
  // empate e ordem instável.
  //
  // De propósito NÃO mexe em `version` nem emite Activity: prioridade
  // visual não é mudança do negócio (mesmo raciocínio de
  // OpportunityItemService#sincronizarValor, que documenta por que
  // incrementar a versão aqui derrubaria o "Salvar" de um card aberto).
  async reorder(
    tx: TenantTx,
    membership: MembershipContext,
    stageId: string,
    orderedIds: string[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;

    for (const id of orderedIds) {
      const opportunity = await this.mustBeVisible(tx, membership, id, 'write');
      if (opportunity.stageId !== stageId) {
        throw new BadRequestException(
          'Todas as oportunidades precisam estar na etapa informada.',
        );
      }
    }

    for (const [index, id] of orderedIds.entries()) {
      await tx.opportunity.updateMany({
        where: { id, workspaceId: membership.workspaceId },
        data: { position: index },
      });
    }
  }

  async findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<OpportunityWithDetails> {
    await this.mustBeVisible(tx, membership, id);
    return tx.opportunity.findUniqueOrThrow({
      where: { id },
      include: {
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { edits: { orderBy: { editedAt: 'asc' } } },
        },
        items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateOpportunityDto,
  ): Promise<Opportunity> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    if (dto.version !== existing.version) {
      throw new OptimisticConcurrencyException(existing.version);
    }

    if (
      dto.pipelineId &&
      dto.pipelineId !== existing.pipelineId &&
      !dto.stageId
    ) {
      throw new BadRequestException(
        'Ao mudar pipelineId, stageId também precisa ser informado (evita ambiguidade sobre qual pipeline o stage pertence).',
      );
    }

    const nextPipelineId = dto.pipelineId ?? existing.pipelineId;
    const nextStageId = dto.stageId ?? existing.stageId;

    let fromStage: Stage | null = null;
    let toStage: Stage | null = null;
    const stageChanged = nextStageId !== existing.stageId;
    if (stageChanged) {
      toStage = await this.mustStageBelongToPipeline(
        tx,
        membership.workspaceId,
        nextPipelineId,
        nextStageId,
      );
      fromStage = await tx.stage.findUnique({
        where: { id: existing.stageId },
      });
    }

    const nextStatus = dto.status ?? existing.status;
    this.assertValidTransition(existing.status, nextStatus);

    const nextLostReason =
      nextStatus === 'lost' ? (dto.lostReason ?? existing.lostReason) : null;
    if (nextStatus === 'lost' && !nextLostReason) {
      throw new BadRequestException(
        'status "lost" exige lostReason preenchido.',
      );
    }

    if (dto.ownerUserId) {
      await assertActiveMembership(tx, membership.workspaceId, dto.ownerUserId);
      // Trocar o representante só pra membro marcado como Vendedor
      // (2026-09-17). Salvar o card sem mexer no dono não cai aqui — o
      // card de antes da marcação continua salvável.
      if (dto.ownerUserId !== existing.ownerUserId) {
        await this.mustBeVendedor(tx, membership.workspaceId, dto.ownerUserId);
      }
    }
    if (dto.companyId) {
      await this.mustCompanyExist(tx, membership.workspaceId, dto.companyId);
    }

    const closing = existing.status === 'open' && nextStatus !== 'open';
    const reopening = existing.status !== 'open' && nextStatus === 'open';
    const closedAt = closing
      ? new Date()
      : reopening
        ? null
        : existing.closedAt;

    const sla = this.proximoSla(existing, {
      fromStage,
      toStage,
      tratamento: dto.slaTratamento,
    });
    const standbyAt = this.proximoStandby(existing, dto, nextStatus);

    const result = await tx.opportunity.updateMany({
      where: { id: existing.id, version: existing.version },
      data: {
        companyId: dto.companyId,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        ownerUserId: dto.ownerUserId,
        amount: dto.amount,
        currency: dto.currency,
        expectedCloseDate: dto.expectedCloseDate
          ? new Date(dto.expectedCloseDate)
          : undefined,
        slaDueDate: sla.slaDueDate,
        slaRevisionDate: sla.slaRevisionDate,
        description: dto.description,
        status: nextStatus,
        lostReason: nextLostReason,
        closedAt,
        standbyAt,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      // Corrida entre o findFirst acima e este updateMany — outra escrita
      // venceu no meio do caminho. A checagem de dto.version no início é
      // só atalho de UX; esta é a proteção real (compare-and-swap).
      const latest = await tx.opportunity.findUniqueOrThrow({
        where: { id: existing.id },
      });
      throw new OptimisticConcurrencyException(latest.version);
    }

    const updated = await tx.opportunity.findUniqueOrThrow({
      where: { id: existing.id },
    });

    // Um emit por mudança semântica, não um blob só — mantém stage_change
    // "limpo" pra relatórios futuros de funil/velocity (Fase 5).
    if (stageChanged && fromStage && toStage) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'stage_change',
        payload: {
          fromStageId: fromStage.id,
          toStageId: toStage.id,
          // Nome das etapas gravado junto (2026-09-14): o histórico do
          // card escreve "de X para Y" sem ir buscar o pipeline, e o
          // registro continua legível mesmo se a etapa for renomeada
          // depois.
          fromStageName: fromStage.name,
          toStageName: toStage.name,
          backward: toStage.order < fromStage.order,
          // Tratamento do SLA escolhido ao voltar de Negociação
          // (2026-09-16) — só existe nesse movimento.
          ...(sla.tratamento ? { slaTratamento: sla.tratamento } : {}),
        },
        opportunityId: updated.id,
      });
    }
    if (dto.status && dto.status !== existing.status) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: {
          action: 'status_changed',
          from: existing.status,
          to: nextStatus,
          lostReason: nextLostReason,
        },
        opportunityId: updated.id,
      });
    }
    // Entrou ou saiu do Stand by por pedido (2026-10-22). Sair junto com o
    // encerramento não gera linha própria: o status_changed já conta.
    if (dto.standby !== undefined && standbyAt !== undefined) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: dto.standby
          ? {
              action: 'standby_on',
              expectedCloseDate: valorParaHistorico(updated.expectedCloseDate),
            }
          : { action: 'standby_off' },
        opportunityId: updated.id,
      });
    }
    // Edição do card (2026-09-14): registra o que mudou, de que valor
    // pra qual. Antes ia só a LISTA de nomes de campo tocados — o
    // histórico dizia "editou valor" sem dizer de quanto pra quanto, e
    // `description` nem entrava na conta.
    const changes = camposEditaveis
      .filter((campo) => dto[campo] !== undefined)
      .map((campo) => ({
        field: campo,
        from: valorParaHistorico(existing[campo]),
        to: valorParaHistorico(updated[campo]),
      }))
      .filter((mudanca) => mudanca.from !== mudanca.to);

    if (changes.length > 0) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: { action: 'updated', changes },
        opportunityId: updated.id,
      });
    }

    return updated;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Opportunity> {
    const existing = await this.mustBeVisible(tx, membership, id, 'delete');

    const itens = await tx.opportunityItem.findMany({
      where: { opportunityId: existing.id },
    });
    await registrarExclusao(tx, membership, {
      entidade: 'oportunidade',
      registroId: existing.id,
      titulo: (await nomeDaEmpresa(tx, existing.companyId)) ?? 'Oportunidade',
      contexto: null,
      snapshot: { ...existing, itens },
    });

    const deleted = await tx.opportunity.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'deleted' },
      opportunityId: deleted.id,
    });

    return deleted;
  }

  async restore(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Opportunity> {
    const existing = await tx.opportunity.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (
      !existing ||
      !(await this.policy.can(
        tx,
        membership,
        'write',
        existing,
        'oportunidades',
      ))
    ) {
      throw new NotFoundException('Oportunidade não encontrada.');
    }
    if (!existing.deletedAt) {
      throw new BadRequestException('Oportunidade não está excluída.');
    }

    const restored = await tx.opportunity.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'restored' },
      opportunityId: restored.id,
    });

    return restored;
  }

  // Próximo estado do SLA (ver opportunity-sla.ts). Campo ausente no
  // retorno = não mexe.
  private proximoSla(
    existing: Opportunity,
    mudanca: {
      fromStage: Stage | null;
      toStage: Stage | null;
      tratamento: SlaTratamento | undefined;
    },
  ): {
    slaDueDate?: Date | null;
    slaRevisionDate?: Date;
    tratamento?: SlaTratamento;
  } {
    const { fromStage, toStage, tratamento } = mudanca;

    if (fromStage && toStage) {
      const deProposta = ehEtapaDeProposta(fromStage);
      const paraProposta = ehEtapaDeProposta(toStage);

      if (deProposta && !paraProposta) {
        return existing.slaDueDate ? {} : { slaDueDate: hojeComoData() };
      }
      if (!deProposta && paraProposta) {
        if (!tratamento) {
          throw new BadRequestException(
            'Ao voltar o card para uma etapa de proposta, informe o tratamento do SLA.',
          );
        }
        return tratamento === 'alteracao_cliente'
          ? { slaDueDate: null, slaRevisionDate: hojeComoData(), tratamento }
          : { slaDueDate: null, tratamento };
      }
      return {};
    }

    // Ganhar, perder ou reabrir não mexe no SLA (pedido do usuário,
    // 2026-09-16): ele mede a conclusão da PROPOSTA, não o aceite ou a
    // recusa do cliente.
    return {};
  }

  // Próximo valor de `standbyAt` (pedido do usuário, 2026-10-22).
  // undefined = não mexe.
  // - Entrar: só oportunidade aberta, e com a nova previsão de fechamento
  //   no mesmo pedido, de hoje em diante — é a data em que ela reaparece no
  //   calendário pra ser retomada.
  // - Sair: "Retomar negociação" no card; o card volta pra etapa onde estava.
  // - Encerrar (ganha/perdida) tira do Stand by junto.
  private proximoStandby(
    existing: Opportunity,
    dto: UpdateOpportunityDto,
    nextStatus: OpportunityStatus,
  ): Date | null | undefined {
    if (dto.standby === true) {
      if (existing.status !== 'open' || nextStatus !== 'open') {
        throw new BadRequestException(
          'Só oportunidade em aberto pode ser colocada em stand by.',
        );
      }
      if (existing.standbyAt) {
        throw new BadRequestException('A oportunidade já está em stand by.');
      }
      if (!dto.expectedCloseDate) {
        throw new BadRequestException(
          'Para colocar em stand by, informe a nova previsão de fechamento.',
        );
      }
      if (new Date(dto.expectedCloseDate) < hojeComoData()) {
        throw new BadRequestException(
          'A nova previsão de fechamento não pode ser uma data passada.',
        );
      }
      return new Date();
    }
    if (dto.standby === false) {
      if (!existing.standbyAt) {
        throw new BadRequestException('A oportunidade não está em stand by.');
      }
      return null;
    }
    if (nextStatus !== 'open' && existing.standbyAt) return null;
    return undefined;
  }

  private assertValidTransition(
    from: OpportunityStatus,
    to: OpportunityStatus,
  ): void {
    if (from === to) return;
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(
        `Transição de status "${from}" para "${to}" não é permitida — reabra a oportunidade (status "open") primeiro.`,
      );
    }
  }

  private async mustBeVendedor(
    tx: TenantTx,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const member = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { vendedor: true },
    });
    if (!member?.vendedor) {
      throw new BadRequestException(
        'Só membro marcado como Vendedor pode ser o representante do card.',
      );
    }
  }

  private async mustCompanyExist(
    tx: TenantTx,
    workspaceId: string,
    companyId: string,
  ): Promise<void> {
    const company = await tx.company.findFirst({
      where: { id: companyId, workspaceId },
    });
    if (!company || company.deletedAt) {
      throw new BadRequestException(`Empresa "${companyId}" não encontrada.`);
    }
  }

  private async mustStageBelongToPipeline(
    tx: TenantTx,
    workspaceId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<Stage> {
    const pipeline = await tx.pipeline.findFirst({
      where: { id: pipelineId, workspaceId },
    });
    if (!pipeline) {
      throw new BadRequestException(`Pipeline "${pipelineId}" não encontrado.`);
    }
    const stage = await tx.stage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) {
      throw new BadRequestException(
        `Stage "${stageId}" não pertence ao pipeline "${pipelineId}".`,
      );
    }
    return stage;
  }

  // Público — OpportunityAttachmentService/OpportunityCommentService
  // chamam isto pra confirmar posse antes de assinar URL/gravar
  // comentário, mesmo padrão de TaskService.mustBeVisible.
  async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' | 'delete' = 'read',
  ): Promise<Opportunity> {
    const opportunity = await tx.opportunity.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!opportunity || opportunity.deletedAt) {
      throw new NotFoundException('Oportunidade não encontrada.');
    }
    if (
      !(await this.policy.can(
        tx,
        membership,
        action,
        opportunity,
        'oportunidades',
      ))
    ) {
      throw new NotFoundException('Oportunidade não encontrada.');
    }
    return opportunity;
  }
}
