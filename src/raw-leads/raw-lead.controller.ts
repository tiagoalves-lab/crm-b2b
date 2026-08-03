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
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { BulkRawLeadsDto } from './dto/bulk-raw-leads.dto';
import { CreateRawLeadDto } from './dto/create-raw-lead.dto';
import { ListRawLeadsQueryDto } from './dto/list-raw-leads-query.dto';
import { UpdateLeadTierDto } from './dto/update-lead-tier.dto';
import { RawLeadService } from './raw-lead.service';

@Controller('raw-leads')
export class RawLeadController {
  constructor(
    private readonly rawLeads: RawLeadService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateRawLeadDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.create(tx, membership, dto),
    );
  }

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListRawLeadsQueryDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.findAll(tx, membership, query),
    );
  }

  @Post('bulk-approve')
  bulkApprove(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: BulkRawLeadsDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.bulkApprove(tx, membership, dto.ids),
    );
  }

  @Post('bulk-discard')
  bulkDiscard(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: BulkRawLeadsDto,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.bulkDiscard(tx, membership, dto.ids),
    );
  }

  @Post('rescore')
  rescore(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.rescoreAll(tx, membership),
    );
  }

  // Importação em massa (planilha CSV/XLSX do crawler) — arquivo nunca é
  // gravado em disco (memoryStorage do FileInterceptor), só fica em
  // memória pelo tempo da requisição. Limite de 10MB é generoso pra uma
  // planilha de texto (a de referência, ~150 linhas, tem menos de 30KB).
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
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) =>
        this.rawLeads.importSpreadsheet(tx, membership, {
          buffer: file.buffer,
          originalname: file.originalname,
        }),
    );
  }

  @Get(':id')
  findOne(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.findOne(tx, membership, id),
    );
  }

  @Post(':id/approve')
  approve(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
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
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.setManualTier(tx, membership, id, dto),
    );
  }

  @Post(':id/discard')
  discard(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      { userId: membership.userId, workspaceId: membership.workspaceId, role: membership.role },
      (tx) => this.rawLeads.discard(tx, membership, id),
    );
  }
}
