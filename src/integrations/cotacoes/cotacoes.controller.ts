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
import { AvancarEstagioDto } from './dto/avancar-estagio.dto';
import { BuscarCompaniesQueryDto } from './dto/buscar-companies-query.dto';
import { FilaQueryDto } from './dto/fila-query.dto';
import { ItensValorDto } from './dto/itens-valor.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { TrelloComentariosDto } from './dto/trello-comentarios.dto';
import { TrelloStatusQueryDto } from './dto/trello-status-query.dto';
import { TrelloVinculoDto } from './dto/trello-vinculo.dto';
import { UpsertClienteDto } from './dto/upsert-cliente.dto';
import { UpsertPropostaDto } from './dto/upsert-proposta.dto';

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

  // Busca ao vivo de cliente (2026-09-23) — usada pelo modal de escolher
  // cliente do orçamento e pelo cadastro de oportunidade a partir do
  // cartão do Trello. Existe porque o espelho do app só atualiza a cada
  // varredura, e empresa criada no CRM há minutos precisa aparecer na
  // hora. Limite por IP mais alto que o da varredura: aqui é uma chamada
  // por termo digitado, não uma por hora.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Public()
  @Get('companies/busca')
  async buscarCompanies(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: BuscarCompaniesQueryDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.buscarCompanies(query);
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

  // Fila de cotação: as solicitações abertas com seus itens. Uma chamada por
  // abertura da tela do app; o cruzamento com os orçamentos é lá.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @Get('fila')
  async fila(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: FilaQueryDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.fila(query);
  }

  // "Enviar proposta ao CRM" — recebe a proposta CONGELADA do app de
  // cotações (HTML + hash), vira PDF aqui e entra como anexo do card.
  // Throttle apertado de propósito: cada chamada acorda um Chromium e o
  // envio é ato humano, um por proposta.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('propostas')
  async upsertProposta(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: UpsertPropostaDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.upsertProposta(dto);
  }

  // "O Chromium sobe neste contêiner?" — a única parte do envio de proposta
  // que não se prova no PC de quem programa, só no servidor. Um curl com o
  // token responde, sem precisar de uma proposta de verdade.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Get('propostas/diagnostico')
  async diagnosticoProposta(
    @Headers('authorization') authorization: string | undefined,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.diagnosticoPdf();
  }

  // Valor dos itens do card a partir do orçamento enviado (2026-10-08).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('itens-valor')
  async itensValor(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: ItensValorDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.itensValor(dto);
  }

  // Situação do orçamento vinculado → estágio do card (2026-10-08). Só
  // AVANÇA: card já à frente (ou fechado) fica onde está — ver
  // CotacoesService#avancarEstagio.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('estagio')
  async avancarEstagio(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: AvancarEstagioDto,
  ) {
    this.cotacoes.assertTokenValido(authorization);
    return this.cotacoes.avancarEstagio(dto);
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
