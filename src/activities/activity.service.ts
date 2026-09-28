import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Activity, ActivityType, Prisma } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { etapaAvancada, etapaDoSubtipo } from '../raw-leads/etapa-funil';
import { CONTACT_REQUIRED_ACTIVITY_SUBTIPOS } from './activity-subtipo.constants';
import type { CreateActivityDto } from './dto/create-activity.dto';

export interface EmitActivityInput {
  workspaceId: string;
  actorUserId: string | null;
  type: ActivityType;
  payload?: Record<string, unknown>;
  companyId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
}

// Ponto único de escrita em Activity — todo resource service chama isso em
// vez de duplicar o insert (registro automático, ex.: stage_change).
// `createManual` (abaixo) é o caminho pro usuário registrar uma nota/
// ligação/e-mail de próprio punho (SPEC-CRM-GAMA.md §4.1/§4.2, aba
// Timeline) — endpoint HTTP em ActivityController.
@Injectable()
export class ActivityService {
  constructor(private readonly policy: PolicyService) {}

  // Registrar uma interação exige só visibilidade de leitura da entidade
  // referenciada — mesmo critério já usado pra comentário de Task
  // (colaborativo: um gerente que vê a company/opportunity de um
  // subordinado pode registrar nota nela sem ser o owner).
  async createManual(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateActivityDto,
  ): Promise<Activity> {
    // Defesa em profundidade independente do @ExactlyOneOf do DTO — mesma
    // lacuna já documentada em TaskService.mustTargetExist/
    // ActivityQueryService.assertEntityVisible: como os dois campos são
    // @IsOptional(), o class-validator pula o decorator inteiro quando
    // ambos estão undefined, deixando "0 de 2" passar pra cá. Sem esta
    // checagem, cair direto em emit() rejeita com um Error genérico (500),
    // não um 400 limpo.
    const targets = [dto.companyId, dto.opportunityId].filter(
      (value) => value !== undefined,
    );
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Exatamente um de companyId/opportunityId deve ser informado.',
      );
    }

    let companyIdForContact: string | undefined;

    if (dto.companyId) {
      const company = await tx.company.findFirst({
        where: { id: dto.companyId, workspaceId: membership.workspaceId },
      });
      // canReadCompany(), não can(): mesma regra da ficha/Timeline (ver
      // ActivityQueryService.assertEntityVisible) — nota registrada de
      // dentro da ficha tem que valer em toda empresa que a ficha abre.
      if (
        !company ||
        company.deletedAt ||
        !(await this.policy.canReadCompany(tx, membership, company.id))
      ) {
        throw new NotFoundException('Empresa não encontrada.');
      }
      companyIdForContact = company.id;
    } else if (dto.opportunityId) {
      const opportunity = await tx.opportunity.findFirst({
        where: { id: dto.opportunityId, workspaceId: membership.workspaceId },
      });
      if (
        !opportunity ||
        opportunity.deletedAt ||
        !(await this.policy.can(
          tx,
          membership,
          'read',
          opportunity,
          'oportunidades',
        ))
      ) {
        throw new NotFoundException('Oportunidade não encontrada.');
      }
      companyIdForContact = opportunity.companyId ?? undefined;
    }

    // Contato obrigatório pra ligação/reunião/visita/e-mail (pedido direto
    // do usuário, 2026-08-05) — mesma regra de Task.contactId, replicada
    // aqui porque Activity não compartilha o enum de Task.
    if (
      dto.subtipo &&
      CONTACT_REQUIRED_ACTIVITY_SUBTIPOS.includes(dto.subtipo) &&
      !dto.contactId
    ) {
      throw new BadRequestException(
        'Contato é obrigatório para registros do tipo ligação, reunião, visita ou e-mail.',
      );
    }

    // payload.contatoNome denormalizado a partir do nome atual do contato
    // (não do que o cliente mandaria) — mesmo padrão já usado em outros
    // emits deste projeto (ex.: RawLeadService#approve com razaoSocial):
    // exibir na Timeline sem precisar de JOIN em todo GET /activities.
    let contatoNome: string | undefined;
    if (dto.contactId) {
      const contact = await this.mustContactBelongToCompany(
        tx,
        membership.workspaceId,
        dto.contactId,
        companyIdForContact,
      );
      contatoNome = contact.nome;
    }

    const activity = await this.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: dto.type,
      payload: {
        texto: dto.texto,
        ...(dto.subtipo ? { subtipo: dto.subtipo } : {}),
        ...(contatoNome ? { contatoNome } : {}),
      },
      companyId: dto.companyId,
      opportunityId: dto.opportunityId,
      contactId: dto.contactId,
    });

    if (dto.companyId) {
      await this.avancarEtapaDoLead(tx, dto.companyId, dto.subtipo);
    }

    return activity;
  }

  // Registro na Timeline empurra o lead no funil de prospecção
  // (2026-09-23) — anotação/ligação/visita/e-mail tiram o cartão da fila
  // parada e o levam pra Andamento; reunião leva pra Reunião. Só empurra
  // pra frente e só mexe em lead ainda em triagem (ver etapa-funil.ts).
  //
  // Escrito direto pelo tx (updateMany, não o RawLeadService): a
  // visibilidade da empresa já foi conferida acima, o RLS por workspace
  // vale na mesma transação, e injetar o service de leads aqui criaria
  // ciclo de módulo — RawLeadModule já depende de ActivityService.
  private async avancarEtapaDoLead(
    tx: TenantTx,
    companyId: string,
    subtipo: string | undefined,
  ): Promise<void> {
    const alvo = etapaDoSubtipo(subtipo);
    if (!alvo) return;

    const lead = await tx.rawLead.findFirst({
      where: { promotedCompanyId: companyId, status: 'novo' },
      select: { id: true, etapa: true },
    });
    if (!lead) return;

    const proxima = etapaAvancada(lead.etapa, alvo);
    if (proxima === lead.etapa) return;

    // updateMany (não update): o RLS de raw_leads pode deixar a pessoa
    // LER o lead pela equipe de vendas da empresa e não deixar escrever
    // nele. Com update por id isso viraria P2025 e derrubaria o registro
    // da anotação, que é a ação que a pessoa pediu — aqui, no máximo, a
    // etapa não anda.
    await tx.rawLead.updateMany({
      where: { id: lead.id },
      data: { etapa: proxima },
    });
  }

  private async mustContactBelongToCompany(
    tx: TenantTx,
    workspaceId: string,
    contactId: string,
    companyId: string | undefined,
  ) {
    const contact = companyId
      ? await tx.contact.findFirst({
          where: { id: contactId, workspaceId, companyId },
        })
      : null;
    if (!contact) {
      throw new BadRequestException(
        `Contato "${contactId}" não encontrado para a empresa deste registro.`,
      );
    }
    return contact;
  }

  emit(tx: TenantTx, input: EmitActivityInput): Promise<Activity> {
    const targets = [input.companyId, input.opportunityId].filter(
      (id): id is string => id !== undefined && id !== null,
    );
    if (targets.length !== 1) {
      throw new Error(
        'ActivityService.emit exige exatamente um de companyId/opportunityId — erro de chamador, não de input de usuário.',
      );
    }

    return tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        type: input.type,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        companyId: input.companyId ?? undefined,
        opportunityId: input.opportunityId ?? undefined,
        contactId: input.contactId ?? undefined,
      },
    });
  }
}
