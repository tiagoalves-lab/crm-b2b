import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PolicyService } from '../policy/policy.service';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import {
  AlertaRemessaDto,
  ClassificarEntradaDto,
  ConsultaNotasQueryDto,
  EntradasQueryDto,
  RelatorioReceitaQueryDto,
  RemessasQueryDto,
  SyncEmitidasQueryDto,
  VinculoRemessaDto,
} from './dto/fiscal-query.dto';
import { consultarNotas } from './consulta-notas';
import { FiscalNotasSyncService } from './fiscal-notas-sync.service';
import { FiscalService } from './fiscal.service';

// Console fiscal (docs/console-fiscal.md). Ler exige a permissão do
// módulo "fiscal" — vale também pro admin, que aqui não tem bypass
// (MODULOS_SEM_BYPASS_ADMIN); só o owner passa direto.
// Disparar a carga é owner/admin com o console, mesmo critério das sincronizações do
// eGestor (EgestorSyncController) — chama a API externa e grava dado do
// workspace inteiro. Nenhuma rota recebe id: tudo é escopado pelo
// workspace do membro logado.

const SYNC_ROLES = new Set(['owner', 'admin']);

// Início da carga (decisão 5.1).
const CARGA_DESDE_PADRAO = '2025-01-01';

@Controller('fiscal')
export class FiscalController {
  constructor(
    private readonly fiscal: FiscalService,
    private readonly sync: FiscalNotasSyncService,
    private readonly tenantContext: TenantContextService,
    private readonly policy: PolicyService,
  ) {}

  @Get('relatorio-receita')
  relatorioReceita(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: RelatorioReceitaQueryDto,
  ) {
    this.exigirLeitura(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.relatorioReceita(tx, membership.workspaceId, query),
    );
  }

  @Get('remessas')
  remessas(@CurrentMembership() membership: MembershipContext, @Query() query: RemessasQueryDto) {
    this.exigirLeitura(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.remessas(tx, membership.workspaceId, query),
    );
  }

  // Arrastar um retorno pra remessa / desfazer (decisão 7.5). Exige
  // "Editar" no módulo fiscal. Sem id na rota: as notas vão pela chave no
  // corpo e o serviço só acha as do workspace do membro (RLS).
  @Post('remessas/vinculos')
  @HttpCode(200)
  vincular(@CurrentMembership() membership: MembershipContext, @Body() dto: VinculoRemessaDto) {
    this.exigirEdicao(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.decidirVinculo(tx, membership.workspaceId, membership.userId, dto, 'vincular'),
    );
  }

  @Post('remessas/vinculos/desfazer')
  @HttpCode(200)
  desvincular(@CurrentMembership() membership: MembershipContext, @Body() dto: VinculoRemessaDto) {
    this.exigirEdicao(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.decidirVinculo(tx, membership.workspaceId, membership.userId, dto, 'desvincular'),
    );
  }

  // Alerta do Controle de remessas tratado / reaberto (decisão 7.7). Mesmo
  // "Editar" do vínculo; a remessa vai pela chave e o serviço só acha as
  // do workspace do membro (RLS).
  @Post('remessas/alertas/tratar')
  @HttpCode(200)
  tratarAlerta(@CurrentMembership() membership: MembershipContext, @Body() dto: AlertaRemessaDto) {
    this.exigirEdicao(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.registrarAlerta(tx, membership.workspaceId, membership.userId, dto, 'tratar'),
    );
  }

  @Post('remessas/alertas/reabrir')
  @HttpCode(200)
  reabrirAlerta(@CurrentMembership() membership: MembershipContext, @Body() dto: AlertaRemessaDto) {
    this.exigirEdicao(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.registrarAlerta(tx, membership.workspaceId, membership.userId, dto, 'reabrir'),
    );
  }

  // Notas de entrada com a classificação de cada item (decisão 7.8).
  @Get('entradas')
  entradas(@CurrentMembership() membership: MembershipContext, @Query() query: EntradasQueryDto) {
    this.exigirLeitura(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.entradas(tx, membership.workspaceId, query),
    );
  }

  // Classificar itens de uma nota de entrada. Mesmo "Editar" do Controle de
  // remessas; a nota vai pela chave no corpo e o serviço só acha as do
  // workspace do membro (RLS).
  @Post('entradas/classificar')
  @HttpCode(200)
  classificarEntrada(@CurrentMembership() membership: MembershipContext, @Body() dto: ClassificarEntradaDto) {
    this.exigirEdicao(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      this.fiscal.classificarEntrada(tx, membership.workspaceId, membership.userId, dto),
    );
  }

  // Consultar notas: pesquisa livre em todas as notas (emitidas, recebidas
  // e NFS-e), só leitura.
  @Get('consulta')
  consulta(@CurrentMembership() membership: MembershipContext, @Query() query: ConsultaNotasQueryDto) {
    this.exigirLeitura(membership);
    return this.tenantContext.run(contexto(membership), (tx) =>
      consultarNotas(tx, membership.workspaceId, query),
    );
  }

  @Get('sync/status')
  statusCarga(@CurrentMembership() membership: MembershipContext) {
    this.exigirLeitura(membership);
    return this.sync.status();
  }

  // Devolve na hora (202) e a carga segue em segundo plano — acompanhar
  // por GET /fiscal/sync/status. Clicar de novo com uma carga rodando não
  // dispara outra, só devolve o andamento.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('sync/emitidas')
  @HttpCode(202)
  carregarEmitidas(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: SyncEmitidasQueryDto,
  ) {
    this.exigirLeitura(membership);
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException('Só owner/admin podem atualizar as notas do eGestor.');
    }
    return this.sync.iniciar(contexto(membership), {
      desde: query.desde ?? CARGA_DESDE_PADRAO,
    });
  }

  private exigirLeitura(membership: MembershipContext): void {
    if (!this.policy.canModule(membership, 'fiscal', 'ver')) {
      throw new ForbiddenException('Sem permissão para o Console fiscal.');
    }
  }

  private exigirEdicao(membership: MembershipContext): void {
    this.exigirLeitura(membership);
    if (!this.policy.canModule(membership, 'fiscal', 'editar')) {
      throw new ForbiddenException('Sem permissão para editar no Console fiscal.');
    }
  }
}

function contexto(membership: MembershipContext) {
  return {
    userId: membership.userId,
    workspaceId: membership.workspaceId,
    role: membership.role,
  };
}
