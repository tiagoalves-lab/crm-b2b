import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CartaoCnpjService } from '../companies/cartao-cnpj.service';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { BulkRawLeadsDto } from './dto/bulk-raw-leads.dto';
import { CreateRawLeadDto } from './dto/create-raw-lead.dto';
import { ListRawLeadsQueryDto } from './dto/list-raw-leads-query.dto';
import { UpdateLeadCadastroDto } from './dto/update-lead-cadastro.dto';
import { UpdateLeadEtapaDto } from './dto/update-lead-etapa.dto';
import { UpdateLeadSegmentoDto } from './dto/update-lead-segmento.dto';
import { UpdateLeadTagsDto } from './dto/update-lead-tags.dto';
import { UpdateLeadTierDto } from './dto/update-lead-tier.dto';
import { RawLeadService } from './raw-lead.service';

@Controller('raw-leads')
export class RawLeadController {
  constructor(
    private readonly rawLeads: RawLeadService,
    private readonly tenantContext: TenantContextService,
    private readonly cartaoCnpj: CartaoCnpjService,
  ) {}

  // Lead novo com CNPJ já leva o Cartão CNPJ pra ficha da empresa — ver
  // CartaoCnpjService. Em segundo plano, depois da transação: com a Receita
  // fora do ar a consulta leva até 20 s, e o lead já está salvo
  // (preencher() nunca lança).
  @Post()
  async create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateRawLeadDto,
  ) {
    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
    const lead = await this.tenantContext.run(ctx, (tx) =>
      this.rawLeads.create(tx, membership, dto),
    );
    if (lead.promotedCompanyId && lead.cnpj) {
      void this.cartaoCnpj.preencher(ctx, membership, lead.promotedCompanyId, {
        forcar: false,
      });
    }
    return lead;
  }

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListRawLeadsQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.findAll(tx, membership, query),
    );
  }

  @Post('bulk-approve')
  bulkApprove(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: BulkRawLeadsDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.bulkApprove(tx, membership, dto.ids),
    );
  }

  @Post('bulk-discard')
  bulkDiscard(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: BulkRawLeadsDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.bulkDiscard(tx, membership, dto.ids),
    );
  }

  @Post('rescore')
  rescore(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.rescoreAll(tx, membership),
    );
  }

  // Importação em massa (planilha CSV/XLSX do crawler) — arquivo nunca é
  // gravado em disco (memoryStorage do FileInterceptor), só fica em
  // memória pelo tempo da requisição. Limite de 10MB é generoso pra uma
  // planilha de texto (a de referência, ~150 linhas, tem menos de 30KB).
  // Limite apertado (docs/seguranca.md, decisão 5.4): cada chamada lê uma
  // planilha inteira em memória e escreve linha a linha no banco. É a
  // rota mais cara do backend — 10/min é folgado pro uso real (importar
  // uma planilha é ação manual e esporádica) e ainda assim impede que um
  // login comprometido use isso pra derrubar o banco.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  importSpreadsheet(
    @CurrentMembership() membership: MembershipContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "file").');
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.originalname)) {
      throw new BadRequestException(
        'Formato não suportado — envie um arquivo .csv ou .xlsx.',
      );
    }
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) =>
        this.rawLeads.importSpreadsheet(tx, membership, {
          buffer: file.buffer,
          originalname: file.originalname,
        }),
      // Timeout default do Prisma (5000ms) estoura fácil aqui — cada linha
      // é uma company nova (+ activity) numa idas-e-vindas própria pro
      // Postgres, então planilhas de dezenas/centenas de linhas passam
      // longe de 5s (achado depurando um 500 real, "Transaction already
      // closed" — P2028 —, 2026-08-06). 2 minutos é generoso pro limite de
      // 10MB do upload sem deixar uma conexão do pool presa indefinidamente
      // se algo travar de verdade.
      { timeoutMs: 120_000 },
    );
  }

  // Modelo padrão de planilha com múltiplos contatos por empresa (layout
  // fixo, ver contacts-spreadsheet-import.util.ts) — pedido do usuário,
  // 2026-08-03, fora do formato tolerante do crawler acima.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('import-contacts')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async importSpreadsheetWithContacts(
    @CurrentMembership() membership: MembershipContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "file").');
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.originalname)) {
      throw new BadRequestException(
        'Formato não suportado — envie um arquivo .csv ou .xlsx.',
      );
    }

    const contexto = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    // Coluna "Representante" (2026-09-23): o de-para nome/login/e-mail →
    // membro é montado ANTES da transação do import — transação curta pro
    // banco, chamada HTTP ao Supabase Auth fora de qualquer transação (ver
    // RawLeadService#indexarRepresentantes).
    const membrosAtivos = await this.tenantContext.run(contexto, (tx) =>
      this.rawLeads.listarMembrosAtivos(tx, membership),
    );
    const representantes =
      await this.rawLeads.indexarRepresentantes(membrosAtivos);

    return this.tenantContext.run(
      contexto,
      (tx) =>
        this.rawLeads.importSpreadsheetWithContacts(
          tx,
          membership,
          {
            buffer: file.buffer,
            originalname: file.originalname,
          },
          representantes,
        ),
      // Mesmo motivo do endpoint /import acima — aqui é ainda mais lento
      // por linha (company + N contatos, cada um sua própria ida ao
      // banco).
      { timeoutMs: 120_000 },
    );
  }

  @Get(':id')
  findOne(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.findOne(tx, membership, id),
    );
  }

  @Post(':id/approve')
  approve(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.approve(tx, membership, id),
    );
  }

  @Patch(':id/tier')
  setTier(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadTierDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.setManualTier(tx, membership, id, dto),
    );
  }

  // Etapa do funil de prospecção — o arrasto do cartão no quadro
  // (2026-09-23). Ver RawLeadService#setEtapa.
  @Patch(':id/etapa')
  setEtapa(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadEtapaDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.setEtapa(tx, membership, id, dto),
    );
  }

  @Patch(':id/tags')
  setTags(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadTagsDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.setTags(tx, membership, id, dto),
    );
  }

  @Patch(':id/segmento')
  setSegmento(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadSegmentoDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.setSegmento(tx, membership, id, dto),
    );
  }

  // Completar o cadastro de um lead em triagem (CNPJ + dados da Receita) —
  // ver RawLeadService#updateCadastro. Veio CNPJ = o usuário consultou a
  // Receita agora: reconsulta também o Cartão CNPJ da ficha da empresa
  // (CartaoCnpjService), pras duas telas mostrarem o mesmo dado. Aqui
  // ESPERA a consulta (2026-10-28), ao contrário do create(): a aba "Dados
  // cadastrais" do lead mostra esse cartão, e em segundo plano a tela
  // recarregava antes dele ficar pronto. A Receita acabou de responder pro
  // navegador, então a espera é curta; preencher() nunca lança.
  @Patch(':id/cadastro')
  async updateCadastro(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadCadastroDto,
  ) {
    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
    const lead = await this.tenantContext.run(ctx, (tx) =>
      this.rawLeads.updateCadastro(tx, membership, id, dto),
    );
    if (dto.cnpj && lead.promotedCompanyId) {
      await this.cartaoCnpj.preencher(ctx, membership, lead.promotedCompanyId, {
        forcar: true,
      });
    }
    return lead;
  }

  @Post(':id/discard')
  discard(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.discard(tx, membership, id),
    );
  }

  // Desfaz o descarte — ver RawLeadService#restore.
  @Post(':id/restore')
  restore(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.restore(tx, membership, id),
    );
  }

  // Desfaz a conversão — ver RawLeadService#unconvert.
  @Post(':id/unconvert')
  unconvert(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.rawLeads.unconvert(tx, membership, id),
    );
  }
}
