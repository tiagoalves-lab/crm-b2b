import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Contact } from '@prisma/client';
import type { PermissionAction } from '../policy/permission-catalog';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateContactDto } from './dto/create-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';

// Ver/criar/editar/excluir agora vêm da matriz de permissões (módulo
// "contatos", ver permission-catalog.ts) — os presets default reproduzem o
// que era hardcoded antes desta feature (2026-08-03: "representante
// somente ver e inserir"; editar/remover era owner/admin fixo), mas agora
// dá pra abrir isso pra um manager específico via checkbox, se o usuário
// quiser (respeitado o teto: um ator não concede mais do que ele mesmo
// tem, ver MembershipService#capPermissionsToActor).
//
// Agenda de contatos de uma empresa — reusada tal e qual na ficha de Leads
// (companyId = RawLead.promotedCompanyId, sempre preenchido desde a
// criação do lead). Mirror simplificado de OpportunityCommentService pra
// existência/visibilidade: `tx.company.findFirst` já roda sob a RLS de
// "companies" (Fatia 9), que filtra por owner/role; se a company não é
// visível pra este membership, ela simplesmente não aparece aqui, mesmo
// raciocínio de TaskService#mustTargetExist. A restrição de papel abaixo
// (update/remove) é checagem de aplicação, separada da RLS.
@Injectable()
export class ContactService {
  constructor(private readonly policy: PolicyService) {}

  // Dono do contato (pedido direto do usuário, 2026-08-06, junto da
  // decisão de empresa compartilhada — ver CompanyService#create): quando
  // dois representantes cadastram a mesma empresa, cada um só enxerga os
  // PRÓPRIOS contatos ali, não os do outro. owner/admin/manager (+
  // hierarquia) continuam vendo todos — mesmo PolicyService.scopeFilter
  // já usado por Company/Opportunity/Task.
  async list(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
  ): Promise<Contact[]> {
    this.mustCanModule(membership, 'ver');
    await this.mustCompanyExist(tx, membership.workspaceId, companyId);
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    return tx.contact.findMany({
      where: { companyId, ...ownerFilter },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Prévia em lote pra listas (Prospecção, 2026-08-07, pedido direto do
  // usuário: coluna "Contatos" ao lado de "Empresa") — uma query só pra
  // N empresas, em vez de listContacts() (acima) chamado N vezes por
  // linha da tabela (evitaria N+1 round-trip HTTP e, pior, N+1 conexão
  // no pool do Postgres, já documentado como sensível neste projeto). Sem
  // checagem de existência por empresa (mustCompanyExist) de propósito —
  // é só uma prévia read-only, o próprio scopeFilter + workspaceId já
  // bastam pra não vazar contato de fora do escopo do membership; uma
  // company inexistente/de outro workspace simplesmente não traz linha.
  async listByCompanyIds(
    tx: TenantTx,
    membership: MembershipContext,
    companyIds: string[],
  ): Promise<Contact[]> {
    if (companyIds.length === 0) {
      return [];
    }
    this.mustCanModule(membership, 'ver');
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    return tx.contact.findMany({
      where: {
        workspaceId: membership.workspaceId,
        companyId: { in: companyIds },
        ...ownerFilter,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
    dto: CreateContactDto,
  ): Promise<Contact> {
    this.mustCanModule(membership, 'criar');
    await this.mustCompanyExist(tx, membership.workspaceId, companyId);
    try {
      return await tx.contact.create({
        data: {
          workspaceId: membership.workspaceId,
          companyId,
          nome: dto.nome,
          cargo: dto.cargo,
          email: dto.email,
          telefone: dto.telefone,
          decisor: dto.decisor ?? false,
          ownerUserId: membership.userId,
        },
      });
    } catch (error) {
      // Índice contacts_no_exact_duplicate (migration
      // 20260813120000_contacts_anti_duplicate): registro idêntico em
      // empresa/dono/nome/e-mail/telefone/cargo. Sem este catch o usuário
      // veria a mensagem genérica do PrismaExceptionFilter, que cita o
      // nome do índice — informação de banco, não de negócio.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Este contato já está cadastrado nesta empresa.',
        );
      }
      throw error;
    }
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
    contactId: string,
    dto: UpdateContactDto,
  ): Promise<Contact> {
    await this.mustCompanyExist(tx, membership.workspaceId, companyId);
    this.mustCanModule(membership, 'editar');
    const existing = await tx.contact.findFirst({
      where: { id: contactId, companyId },
    });
    if (!existing) {
      throw new NotFoundException('Contato não encontrado.');
    }
    return tx.contact.update({
      where: { id: existing.id },
      data: {
        nome: dto.nome,
        cargo: dto.cargo,
        email: dto.email,
        telefone: dto.telefone,
        decisor: dto.decisor,
      },
    });
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
    contactId: string,
  ): Promise<void> {
    await this.mustCompanyExist(tx, membership.workspaceId, companyId);
    this.mustCanModule(membership, 'excluir');
    const existing = await tx.contact.findFirst({
      where: { id: contactId, companyId },
    });
    if (!existing) {
      throw new NotFoundException('Contato não encontrado.');
    }
    await tx.contact.delete({ where: { id: existing.id } });
  }

  private async mustCompanyExist(
    tx: TenantTx,
    workspaceId: string,
    companyId: string,
  ): Promise<void> {
    const company = await tx.company.findFirst({
      where: { id: companyId, workspaceId },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('Empresa não encontrada.');
    }
  }

  // 404 (empresa) checado antes desta chamada de propósito — não revela
  // que o contato existiria pra quem nem enxerga a empresa; aqui só decide
  // 403 pra quem já sabe que a empresa existe mas não tem a permissão.
  private mustCanModule(
    membership: MembershipContext,
    action: PermissionAction,
  ): void {
    if (!this.policy.canModule(membership, 'contatos', action)) {
      throw new ForbiddenException(`Sem permissão para ${action} contatos.`);
    }
  }
}
