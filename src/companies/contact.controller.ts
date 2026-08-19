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
} from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { ListContactsByCompanyIdsDto } from './dto/list-contacts-by-company-ids.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prévia em lote — rota solta em `/contacts` (sem `:companyId` no path,
// por isso é uma classe/prefixo separado do ContactController abaixo,
// que é aninhado). Único consumidor hoje: coluna "Contatos" da tela de
// Prospecção (web/app/dashboard/leads/page.tsx), mas não amarrado a
// RawLead — qualquer tela que precise de prévia de contato por empresa
// pode reusar.
//
// POST (não GET com ?companyIds=a,b,c) — decisão de 2026-08-10, bug real
// em produção: com a lista de Prospecção sem mais o teto de 200 itens
// (ver ListRawLeadsQueryDto), a URL com todos os companyIds passou de
// centenas de KB e a requisição voltava 431 (Request Header Fields Too
// Large) antes mesmo de chegar no handler — página inteira quebrava com
// "server-side exception". Corpo de POST não tem esse teto de tamanho de
// header.
@Controller('contacts')
export class ContactBulkController {
  constructor(
    private readonly contacts: ContactService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  listByCompanyIds(
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: ListContactsByCompanyIdsDto,
  ) {
    // Filtra lixo/malformado em vez de 400 — é uma prévia read-only, não
    // vale a pena derrubar a lista inteira por um id inválido (mesmo
    // motivo de não usar @IsUUID each no DTO).
    const ids = dto.companyIds
      .map((id) => id.trim())
      .filter((id) => UUID_RE.test(id));
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.contacts.listByCompanyIds(tx, membership, ids),
    );
  }
}

@Controller('companies/:companyId/contacts')
export class ContactController {
  constructor(
    private readonly contacts: ContactService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  list(
    @CurrentMembership() membership: MembershipContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.contacts.list(tx, membership, companyId),
    );
  }

  @Post()
  create(
    @CurrentMembership() membership: MembershipContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.contacts.create(tx, membership, companyId, dto),
    );
  }

  @Patch(':contactId')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.contacts.update(tx, membership, companyId, contactId, dto),
    );
  }

  @Delete(':contactId')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.contacts.remove(tx, membership, companyId, contactId),
    );
  }
}
