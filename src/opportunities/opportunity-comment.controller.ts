import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CommentReadDto } from './dto/comment-read.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentFeedQueryDto } from './dto/list-comment-feed-query.dto';
import { MentionDoneDto } from './dto/mention-done.dto';
import { SetMentionsDto } from './dto/set-mentions.dto';
import { PinCommentDto } from './dto/pin-comment.dto';
import { OpportunityCommentService } from './opportunity-comment.service';

@Controller('opportunities/:opportunityId/comments')
export class OpportunityCommentController {
  constructor(
    private readonly comments: OpportunityCommentService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.comments.create(tx, membership, opportunityId, dto),
    );
  }

  @Delete(':commentId')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.comments.remove(tx, membership, opportunityId, commentId),
    );
  }

  // Fixar/desafixar (2026-09-09) — o comentário fixado abre no topo do
  // histórico de anotações do Pipeline.
  @Patch(':commentId/pin')
  setPinned(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: PinCommentDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) =>
        this.comments.setPinned(
          tx,
          membership,
          opportunityId,
          commentId,
          dto.pinned,
        ),
    );
  }

  // Destacar membros num comentário já publicado (2026-09-14).
  @Patch(':commentId/destaques')
  setMentions(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: SetMentionsDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) =>
        this.comments.setMentions(
          tx,
          membership,
          opportunityId,
          commentId,
          dto.mentions,
        ),
    );
  }

  // Baixa da pendência de quem foi destacado no comentário (2026-09-14).
  @Patch(':commentId/pendencia')
  setMentionDone(
    @CurrentMembership() membership: MembershipContext,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: MentionDoneDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) =>
        this.comments.setMentionDone(
          tx,
          membership,
          opportunityId,
          commentId,
          dto.resolvida,
        ),
    );
  }
}

// Histórico de anotações de todos os cards (2026-09-09). Rota própria, e
// não GET /opportunities/comments: ali o segmento cairia no @Get(':id')
// da oportunidade, que exige UUID.
@Controller('opportunity-comments')
export class OpportunityCommentFeedController {
  constructor(
    private readonly comments: OpportunityCommentService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  feed(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListCommentFeedQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.comments.feed(tx, membership, query),
    );
  }

  // "Marcar tudo como lido" (2026-09-17). Declarada antes da rota com
  // :commentId pra leitura ficar óbvia — os métodos HTTP já não colidem.
  @Post('lido')
  @HttpCode(200)
  markAllRead(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.comments.markAllRead(tx, membership),
    );
  }

  // Marcar uma anotação como lida / não lida (2026-09-17).
  @Patch(':commentId/lido')
  setRead(
    @CurrentMembership() membership: MembershipContext,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CommentReadDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.comments.setRead(tx, membership, commentId, dto.lido),
    );
  }
}
