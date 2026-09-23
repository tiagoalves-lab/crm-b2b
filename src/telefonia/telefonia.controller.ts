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
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { CallService } from './call.service';
import { AtualizarChamadaDto } from './dto/atualizar-chamada.dto';
import { CriarDispositivoDto } from './dto/criar-dispositivo.dto';
import { IniciarChamadaDto } from './dto/iniciar-chamada.dto';
import { ListCallsQueryDto } from './dto/list-calls-query.dto';
import { TelefoniaDeviceService } from './telefonia-device.service';

// Rotas do usuário logado (a tela). O que vem da máquina do SDR está em
// TelefoniaAgenteController, com autenticação própria.
@Controller('telefonia')
export class TelefoniaController {
  constructor(
    private readonly calls: CallService,
    private readonly devices: TelefoniaDeviceService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('chamadas')
  iniciar(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: IniciarChamadaDto,
  ) {
    return this.tenantContext.run(ctx(membership), (tx) =>
      this.calls.iniciar(tx, membership, dto),
    );
  }

  @Patch('chamadas/:id')
  atualizar(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarChamadaDto,
  ) {
    return this.tenantContext.run(ctx(membership), (tx) =>
      this.calls.atualizar(tx, membership, id, dto),
    );
  }

  @Get('chamadas')
  listar(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListCallsQueryDto,
  ) {
    return this.tenantContext.run(ctx(membership), (tx) =>
      this.calls.listar(tx, membership, query),
    );
  }

  @Get('dispositivos')
  listarDispositivos(@CurrentMembership() membership: MembershipContext) {
    return this.tenantContext.run(ctx(membership), (tx) =>
      this.devices.listar(tx, membership),
    );
  }

  @Post('dispositivos')
  criarDispositivo(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CriarDispositivoDto,
  ) {
    return this.tenantContext.run(ctx(membership), (tx) =>
      this.devices.criar(tx, membership, dto),
    );
  }

  @Delete('dispositivos/:id')
  revogarDispositivo(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tenantContext.run(ctx(membership), (tx) =>
      this.devices.revogar(tx, membership, id),
    );
  }
}

function ctx(membership: MembershipContext) {
  return {
    userId: membership.userId,
    workspaceId: membership.workspaceId,
    role: membership.role,
  };
}
