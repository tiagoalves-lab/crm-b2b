import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { CotacoesService } from './cotacoes.service';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { TrelloComentariosDto } from './dto/trello-comentarios.dto';
import { TrelloStatusQueryDto } from './dto/trello-status-query.dto';
import { TrelloVinculoDto } from './dto/trello-vinculo.dto';
import { UpsertClienteDto } from './dto/upsert-cliente.dto';

// Rotas públicas de propósito — quem chama é o servidor GAS do app de
// cotações (gama-webapp/CrmService.js), não um usuário logado no Supabase.
// A autenticação real é o token estático COTACOES_API_TOKEN no header
// Authorization (Bearer), conferido em CotacoesService#assertTokenValido —
// mesma disciplina do EgestorWebhookController/MetaLeadsWebhookController:
// toda a superfície pública do módulo mora neste controller só, e está
// declarada em ROTAS_PUBLICAS do test/idor.e2e-spec.ts com testes do
// controle substituto. Throttle por IP (não há usuário autenticado aqui).
@Controller('integrations/cotacoes')
export class CotacoesController {
  constructor(private readonly cotacoes: CotacoesService) {}

  // Varredura paginada pro espelho de clientes das cotações (sync
  // incremental por `desde`, a cada hora + ao abrir a lista de clientes).
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @Get('companies')
  async listar(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListCompaniesQueryDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.listCompanies(query);
  }

  // Cadastro/edição de cliente vindo da cotação — upsert por CNPJ (regra
  // 3.10 das regras de negócio): nunca duplica, nunca vai pra Prospecção.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('clientes')
  async upsertCliente(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: UpsertClienteDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.upsertCliente(dto);
  }

  // ── Trello → funil (2026-09-04) ────────────────────────────────────
  // A tela "Trello | Solicitação de Propostas" do app de cotações mostra
  // os cartões da lista; estas rotas dizem quais já viraram oportunidade,
  // cadastram os que não viraram e espelham o chat do cartão no card.

  // Uma chamada por atualização da tela (ids em lote), não uma por linha.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @Get('trello-status')
  async trelloStatus(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: TrelloStatusQueryDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.trelloStatus(query);
  }

  // "Cadastrar Oportunidade" — idempotente pelo cartão.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('trello-vinculo')
  async trelloVincular(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: TrelloVinculoDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.trelloVincular(dto);
  }

  // "Sincronizar" — só acrescenta mensagem nova no chat do card.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('trello-comentarios')
  async trelloComentarios(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: TrelloComentariosDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.trelloSincronizarComentarios(dto);
  }
}
