import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ListQueryDto } from '../common/dto/list-query.dto';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CompanyAbcService } from './company-abc.service';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Controller('companies')
export class CompanyController {
  constructor(
    private readonly companies: CompanyService,
    private readonly tenantContext: TenantContextService,
    private readonly abc: CompanyAbcService,
  ) {}

  // Recalcula a curva ABC de clientes do workspace inteiro e grava a
  // classe em cada empresa (botão "Calcular curva ABC" na tela Empresas).
  // Rota fixa ANTES de `@Get(':id')`/`@Post(':id/restore')` na ordem do
  // arquivo não importa aqui (é POST em caminho próprio), mas o nome com
  // hífen evita qualquer chance de colidir com um uuid.
  @Post('curva-abc/calcular')
  calcularCurvaAbc(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.abc.calcular(tx, membership),
      // Varre vendas + oportunidades e escreve em ~300 empresas numa
      // transação só; o timeout padrão é curto demais pra isso.
      { timeoutMs: 60_000 },
    );
  }

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.companies.create(tx, membership, dto),
    );
  }

  @Get()
  findAll(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.companies.findAll(tx, membership, query),
    );
  }

  // Tela de Empresas inteira numa requisição (ver CompanyResumo).
  // ATENÇÃO: rota fixa de 1 segmento — precisa vir ANTES de `@Get(':id')`,
  // senão o Nest casa "resumo" com o parâmetro :id e o ParseUUIDPipe
  // devolve 400. Não mover para baixo.
  @Get('resumo')
  resumo(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) =>
        this.companies.resumoParaLista(
          tx,
          membership,
          query.includeDeleted ?? false,
        ),
    );
  }

  // Rota fixa de 2 segmentos ("cnpj/:cnpj") não colide com ":id" (1
  // segmento) — ordem no controller não importa aqui, mas fica antes por
  // convenção (mais específico primeiro).
  @Get('cnpj/:cnpj')
  lookupCnpj(@Param('cnpj') cnpj: string) {
    return this.companies.lookupCnpj(cnpj);
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
      (tx) => this.companies.findOne(tx, membership, id),
    );
  }

  @Patch(':id')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.companies.update(tx, membership, id, dto),
    );
  }

  @Delete(':id')
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.companies.remove(tx, membership, id),
    );
  }

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
      (tx) => this.companies.restore(tx, membership, id),
    );
  }
}
