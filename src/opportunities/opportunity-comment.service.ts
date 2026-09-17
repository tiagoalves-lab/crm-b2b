import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  OpportunityComment,
  OpportunityStatus,
  Prisma,
} from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateCommentDto } from './dto/create-comment.dto';
import type { ListCommentFeedQueryDto } from './dto/list-comment-feed-query.dto';
import { mustTagsBeItems } from './opportunity-tags';
import { OpportunityService } from './opportunity.service';
import { COMPANY_REF_SELECT, type CompanyRef } from '../companies/company-ref';
import { nomeDaEmpresa, registrarExclusao, resumo } from '../deletion-log/registrar-exclusao';

// Item do histórico de anotações do Pipeline (2026-09-09): o comentário
// mais o mínimo da oportunidade pra tela rotular a linha (empresa,
// situação) e linkar o card — mesmo raciocínio de company-ref.ts, sem
// baixar a base de empresas.
//
// `lido` (2026-09-17) já vem resolvido pra quem pediu; a lista de quem
// leu (readByUserIds) não sai da API — é estado de cada pessoa.
export type OpportunityCommentFeedItem = Omit<
  OpportunityComment,
  'readByUserIds'
> & {
  lido: boolean;
  opportunity: {
    id: string;
    status: OpportunityStatus;
    company: CompanyRef | null;
  };
};

// Teto de anotações recentes trazidas pelo histórico quando o cliente não
// pede outro (o fixado vem sempre inteiro, por fora deste teto).
const FEED_LIMIT_PADRAO = 200;

// Mirror de src/tasks/task-comment.service.ts.
@Injectable()
export class OpportunityCommentService {
  constructor(
    private readonly opportunities: OpportunityService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationService,
  ) {}

  // Comentar exige só "read" — mesmo raciocínio de TaskCommentService:
  // colaborativo, não só quem é dono da oportunidade.
  async create(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    dto: CreateCommentDto,
  ): Promise<OpportunityComment> {
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'read',
    );

    // Tag só pode ser item da lista lateral do card (2026-09-04).
    const tags = await mustTagsBeItems(tx, opportunityId, dto.tags);
    // Destaque de membro (2026-09-14) — vira pendência no card pra quem
    // foi destacado.
    const mentionedUserIds = await this.validarDestacados(
      tx,
      membership,
      dto.mentions,
    );

    const comment = await tx.opportunityComment.create({
      data: {
        opportunityId,
        authorUserId: membership.userId,
        body: dto.body,
        tags,
        mentionedUserIds,
      },
    });

    // Aviso por e-mail pra quem foi destacado (2026-09-15). Sai fora desta
    // transação e nunca lança — ver NotificationService.
    this.notifications.avisarMencao({
      workspaceId: membership.workspaceId,
      commentId: comment.id,
      userIds: mentionedUserIds,
      actorUserId: membership.userId,
    });

    return comment;
  }

  // Só membro ATIVO do workspace pode ser destacado — destacar alguém
  // desligado criaria uma pendência que ninguém vê. Duplicata some.
  private async validarDestacados(
    tx: TenantTx,
    membership: MembershipContext,
    mentions: string[] | undefined,
  ): Promise<string[]> {
    const pedidos = [...new Set(mentions ?? [])];
    if (pedidos.length === 0) return [];

    const ativos = await tx.membership.findMany({
      where: {
        workspaceId: membership.workspaceId,
        userId: { in: pedidos },
        status: 'active',
      },
      select: { userId: true },
    });
    const validos = new Set(ativos.map((m) => m.userId));
    const invalido = pedidos.find((id) => !validos.has(id));
    if (invalido) {
      throw new BadRequestException(
        'Só dá pra destacar membros ativos do workspace.',
      );
    }
    return pedidos;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    commentId: string,
  ): Promise<void> {
    this.policy.assertCanDelete(membership, 'oportunidades');
    const opportunity = await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'read',
    );
    const comment = await tx.opportunityComment.findFirst({
      where: { id: commentId, opportunityId },
    });
    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }
    if (comment.authorUserId !== membership.userId) {
      throw new ForbiddenException('Só o autor pode remover o comentário.');
    }
    await registrarExclusao(tx, membership, {
      entidade: 'oportunidade_comentario',
      registroId: comment.id,
      titulo: resumo(comment.body),
      contexto: await nomeDaEmpresa(tx, opportunity.companyId),
      snapshot: comment,
    });
    await tx.opportunityComment.delete({ where: { id: commentId } });
  }

  // Fixar/desafixar (2026-09-09): marca de destaque do comentário, que
  // sobe pro topo do histórico de anotações do Pipeline. Exige só "read"
  // na oportunidade, igual comentar — é sinalização colaborativa, não
  // edição do card; quem fixou fica gravado em pinned_by_user_id.
  async setPinned(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    commentId: string,
    pinned: boolean,
  ): Promise<OpportunityComment> {
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'read',
    );
    const comment = await tx.opportunityComment.findFirst({
      where: { id: commentId, opportunityId },
    });
    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }
    return tx.opportunityComment.update({
      where: { id: commentId },
      data: pinned
        ? { pinnedAt: new Date(), pinnedByUserId: membership.userId }
        : { pinnedAt: null, pinnedByUserId: null },
    });
  }

  // Destacar (ou tirar o destaque de) membros num comentário JÁ PUBLICADO
  // (2026-09-14): a lista chega inteira e substitui a anterior. Mesma
  // permissão de comentar — quem enxerga o card pode destacar; é
  // sinalização de trabalho, não edição do texto de outra pessoa.
  async setMentions(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    commentId: string,
    mentions: string[],
  ): Promise<OpportunityComment> {
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'read',
    );
    const comment = await tx.opportunityComment.findFirst({
      where: { id: commentId, opportunityId },
    });
    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }

    const mentionedUserIds = await this.validarDestacados(
      tx,
      membership,
      mentions,
    );
    // A baixa de alguém só sobrevive se a pessoa continua destacada. Quem
    // é destacado DE NOVO depois de ter saído da lista volta com pendência
    // em aberto — o destaque novo é um pedido novo.
    const mentionsDoneUserIds = comment.mentionsDoneUserIds.filter(
      (id) => mentionedUserIds.includes(id) && comment.mentionedUserIds.includes(id),
    );

    const atualizado = await tx.opportunityComment.update({
      where: { id: commentId },
      data: { mentionedUserIds, mentionsDoneUserIds },
    });

    // Só quem entrou AGORA na lista recebe aviso — quem já estava
    // destacado antes não pode ser avisado de novo a cada edição.
    const novos = mentionedUserIds.filter(
      (id) => !comment.mentionedUserIds.includes(id),
    );
    this.notifications.avisarMencao({
      workspaceId: membership.workspaceId,
      commentId,
      userIds: novos,
      actorUserId: membership.userId,
    });

    return atualizado;
  }

  // Baixa da pendência (2026-09-14): quem foi destacado no comentário
  // marca que resolveu, e o triângulo amarelo do card some PRA ELE — a
  // pendência dos outros destacados continua de pé. Só o próprio
  // destacado dá (ou desfaz) a própria baixa.
  async setMentionDone(
    tx: TenantTx,
    membership: MembershipContext,
    opportunityId: string,
    commentId: string,
    resolvida: boolean,
  ): Promise<OpportunityComment> {
    await this.opportunities.mustBeVisible(
      tx,
      membership,
      opportunityId,
      'read',
    );
    const comment = await tx.opportunityComment.findFirst({
      where: { id: commentId, opportunityId },
    });
    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }
    if (!comment.mentionedUserIds.includes(membership.userId)) {
      throw new ForbiddenException(
        'Só quem foi destacado no comentário pode dar baixa na pendência.',
      );
    }

    const jaDeuBaixa = comment.mentionsDoneUserIds.includes(membership.userId);
    if (resolvida === jaDeuBaixa) return comment;

    const mentionsDoneUserIds = resolvida
      ? [...comment.mentionsDoneUserIds, membership.userId]
      : comment.mentionsDoneUserIds.filter((id) => id !== membership.userId);

    return tx.opportunityComment.update({
      where: { id: commentId },
      data: { mentionsDoneUserIds },
    });
  }

  // Histórico de anotações de TODOS os cards do Pipeline (2026-09-09) —
  // o ícone da barra da tela Pipeline. Duas consultas de propósito: os
  // fixados vêm inteiros (um fixado antigo não pode cair fora da janela
  // dos recentes) e o resto vem pela janela dos mais novos.
  //
  // Visibilidade: mesma regra da lista de oportunidades (canModule 'ver'
  // + scopeFilter) aplicada pela RELAÇÃO — o representante só lê anotação
  // de card que ele já enxerga no quadro.
  async feed(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListCommentFeedQueryDto = {},
  ): Promise<{ items: OpportunityCommentFeedItem[] }> {
    const visiveis = await this.cardsDoHistorico(tx, membership);
    const limit = query.limit ?? FEED_LIMIT_PADRAO;

    const [fixados, recentes] = await Promise.all([
      tx.opportunityComment.findMany({
        where: { pinnedAt: { not: null }, opportunity: visiveis },
        orderBy: { pinnedAt: 'desc' },
      }),
      // `apenasFixados` (2026-09-14): a barra da tela Pipeline só quer
      // saber quantas anotações estão fixadas — não precisa da janela de
      // recentes.
      query.apenasFixados
        ? []
        : tx.opportunityComment.findMany({
            where: { pinnedAt: null, opportunity: visiveis },
            orderBy: { createdAt: 'desc' },
            take: limit,
          }),
    ]);

    const rows = [...fixados, ...recentes];
    if (rows.length === 0) return { items: [] };

    const opportunities = await tx.opportunity.findMany({
      where: { id: { in: [...new Set(rows.map((c) => c.opportunityId))] } },
      select: { id: true, status: true, companyId: true },
    });
    const companies = await tx.company.findMany({
      where: {
        id: { in: [...new Set(opportunities.map((o) => o.companyId))] },
      },
      select: COMPANY_REF_SELECT,
    });
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const opportunityById = new Map(
      opportunities.map((o) => [
        o.id,
        {
          id: o.id,
          status: o.status,
          company: companyById.get(o.companyId) ?? null,
        },
      ]),
    );

    const items = rows.flatMap(({ readByUserIds, ...comment }) => {
      const opportunity = opportunityById.get(comment.opportunityId);
      // Oportunidade que sumiu do alcance entre as duas consultas: fora
      // da lista em vez de linha sem rótulo.
      return opportunity
        ? [
            {
              ...comment,
              lido: this.jaLeu(membership, comment, readByUserIds),
              opportunity,
            },
          ]
        : [];
    });
    return { items };
  }

  // Marcar como lido / não lido (2026-09-17) — uma anotação, só pra quem
  // chamou. Anotação de card fora do alcance do histórico dá 404, igual
  // anotação que não existe.
  async setRead(
    tx: TenantTx,
    membership: MembershipContext,
    commentId: string,
    lido: boolean,
  ): Promise<{ id: string; lido: boolean }> {
    const visiveis = await this.cardsDoHistorico(tx, membership);
    const comment = await tx.opportunityComment.findFirst({
      where: { id: commentId, opportunity: visiveis },
      select: { id: true, readByUserIds: true },
    });
    if (!comment) {
      throw new NotFoundException('Anotação não encontrada.');
    }

    const jaMarcado = comment.readByUserIds.includes(membership.userId);
    if (lido !== jaMarcado) {
      await tx.opportunityComment.update({
        where: { id: commentId },
        data: {
          readByUserIds: lido
            ? [...comment.readByUserIds, membership.userId]
            : comment.readByUserIds.filter((id) => id !== membership.userId),
        },
      });
    }
    return { id: commentId, lido };
  }

  // "Marcar tudo como lido" (2026-09-17): todas as anotações que a pessoa
  // enxerga no histórico — inclusive as que estão fora da janela dos 200
  // recentes. array_append no SQL em vez de ler-e-regravar a lista, pra
  // não apagar a leitura de outra pessoa gravada no mesmo instante.
  async markAllRead(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<{ marcadas: number }> {
    const visiveis = await this.cardsDoHistorico(tx, membership);
    const pendentes = await tx.opportunityComment.findMany({
      where: {
        opportunity: visiveis,
        NOT: { readByUserIds: { has: membership.userId } },
      },
      select: { id: true },
    });
    if (pendentes.length === 0) return { marcadas: 0 };

    const ids = pendentes.map((c) => c.id);
    const marcadas = await tx.$executeRaw`
      UPDATE "opportunity_comments"
         SET "read_by_user_ids" = array_append("read_by_user_ids", ${membership.userId}::uuid)
       WHERE "id" = ANY(${ids}::uuid[])
         AND NOT (${membership.userId}::uuid = ANY("read_by_user_ids"))`;
    return { marcadas };
  }

  // Anotação escrita pela própria pessoa aqui dentro nasce lida — ninguém
  // precisa "ler" o que acabou de escrever. Espelhada do Trello não conta
  // como dela (o autor interno é o usuário de sistema).
  private jaLeu(
    membership: MembershipContext,
    comment: Pick<OpportunityComment, 'authorUserId' | 'externalAuthor'>,
    readByUserIds: string[],
  ): boolean {
    return (
      readByUserIds.includes(membership.userId) ||
      (comment.authorUserId === membership.userId && !comment.externalAuthor)
    );
  }

  // Cards cujas anotações entram no histórico: mesma regra da lista de
  // oportunidades (canModule 'ver' + scopeFilter) — o representante só
  // lê anotação de card que ele já enxerga no quadro.
  private async cardsDoHistorico(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<Prisma.OpportunityWhereInput> {
    if (!this.policy.canModule(membership, 'oportunidades', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver oportunidades.');
    }
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    return {
      workspaceId: membership.workspaceId,
      deletedAt: null,
      ...ownerFilter,
    };
  }
}
