import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { MembershipRole } from '@prisma/client';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { UpdateReportConfigDto } from './dto/update-report-config.dto';
import {
  ReportConfigService,
  TIPOS_CONFIGURAVEIS,
  TIPO_FOLLOWUP,
  TIPO_LEAD_META,
  type TipoReport,
} from './report-config.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { ReportService } from './report.service';

// Tela "E-mail automático" (Administração) + disparo manual. Tudo aqui é
// operação de administração do CRM, não trabalho de venda: restrito a
// owner/admin, com o nav escondendo o item pros demais papéis (defesa em
// profundidade, mesmo padrão da Integração eGestor).
const PAPEIS_PERMITIDOS = new Set<MembershipRole>(['owner', 'admin']);

const MAX_LOG = 40;

@Controller('reports')
export class ReportController {
  constructor(
    private readonly scheduler: ReportSchedulerService,
    private readonly reportConfig: ReportConfigService,
    private readonly reports: ReportService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // Tudo que a tela precisa numa chamada só: configuração dos dois
  // reports, etapas disponíveis no Pipeline (pros checkboxes), quem
  // receberia hoje e os últimos envios.
  @Get('config')
  async config(@CurrentMembership() membership: MembershipContext) {
    this.assertPermitido(membership);
    const ctx = this.ctx(membership);

    const { configs, etapasDisponiveis, elegiveis, log } =
      await this.tenantContext.run(ctx, async (tx) => ({
        configs: await this.reportConfig.listar(tx, membership.workspaceId),
        etapasDisponiveis: await tx.stage.findMany({
          where: { pipeline: { workspaceId: membership.workspaceId } },
          orderBy: { order: 'asc' },
          select: { name: true, order: true },
        }),
        elegiveis: await this.reports.membrosElegiveis(
          tx,
          membership.workspaceId,
        ),
        log: await tx.reportLog.findMany({
          where: { workspaceId: membership.workspaceId },
          orderBy: { criadoEm: 'desc' },
          take: MAX_LOG,
        }),
      }));

    // Fora da transação: é chamada de rede ao Supabase Auth.
    const destinatarios = await this.reports.destinatariosDetalhados(elegiveis);

    return {
      configs,
      etapasDisponiveis: etapasDisponiveis.map((e) => e.name),
      destinatarios,
      envioConfigurado: this.scheduler.envioConfigurado,
      ultimosEnvios: log.map((l) => ({
        tipo: l.tipo,
        referencia: l.refDia,
        status: l.status,
        destinatarios: l.destinatarios,
        erro: l.erro,
        criadoEm: l.criadoEm.toISOString(),
      })),
    };
  }

  @Patch('config/:tipo')
  async salvarConfig(
    @CurrentMembership() membership: MembershipContext,
    @Param('tipo') tipo: string,
    @Body() dto: UpdateReportConfigDto,
  ) {
    this.assertPermitido(membership);
    const tipoValido = this.assertTipo(tipo);

    return this.tenantContext.run(this.ctx(membership), (tx) =>
      this.reportConfig.salvar(
        tx,
        membership.workspaceId,
        tipoValido,
        membership.userId,
        dto,
      ),
    );
  }

  // Envio real, mesma esteira do agendado (inclusive a trava de repetição).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':tipo/enviar')
  async enviar(
    @CurrentMembership() membership: MembershipContext,
    @Param('tipo') tipo: string,
  ) {
    this.assertPermitido(membership);
    const tipoValido = this.assertTipo(tipo);
    // O aviso de lead sai quando o lead chega — não existe "enviar agora"
    // sem um lead novo para anunciar.
    if (tipoValido === TIPO_LEAD_META) {
      throw new BadRequestException(
        'O aviso de lead novo sai sozinho quando um lead entra. Use o envio de teste para conferir o layout.',
      );
    }
    return tipoValido === TIPO_FOLLOWUP
      ? this.scheduler.enviarFollowup()
      : this.scheduler.enviarDiario();
  }

  // Envio de teste pra um endereço só, sem registrar nada: é o caminho
  // pra conferir remetente e layout sem gastar o envio do dia nem enganar
  // a conferência.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':tipo/testar')
  async testar(
    @CurrentMembership() membership: MembershipContext,
    @Param('tipo') tipo: string,
    @Query('para') para?: string,
  ) {
    this.assertPermitido(membership);
    const tipoValido = this.assertTipo(tipo);
    const destinatario = para?.trim();
    if (!destinatario || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      throw new BadRequestException(
        'Informe o e-mail de destino em ?para=alguem@dominio.',
      );
    }
    if (tipoValido === TIPO_LEAD_META) {
      return this.scheduler.enviarLeadMetaTeste(destinatario);
    }
    return tipoValido === TIPO_FOLLOWUP
      ? this.scheduler.enviarFollowupTeste(destinatario)
      : this.scheduler.enviarTeste(destinatario);
  }

  private ctx(membership: MembershipContext) {
    return {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }

  private assertTipo(tipo: string): TipoReport {
    const encontrado = TIPOS_CONFIGURAVEIS.find((t) => t === tipo);
    if (!encontrado) {
      throw new BadRequestException(
        `Report desconhecido: "${tipo}". Use ${TIPOS_CONFIGURAVEIS.join(' ou ')}.`,
      );
    }
    return encontrado;
  }

  private assertPermitido(membership: MembershipContext): void {
    if (!PAPEIS_PERMITIDOS.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem configurar os e-mails automáticos.',
      );
    }
  }
}
