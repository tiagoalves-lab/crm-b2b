import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Activity, Prisma } from '@prisma/client';
import type { PaginatedResult } from '../companies/company.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { ListActivitiesQueryDto } from './dto/list-activities-query.dto';

@Injectable()
export class ActivityQueryService {
  constructor(private readonly policy: PolicyService) {}

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListActivitiesQueryDto,
  ): Promise<PaginatedResult<Activity>> {
    const hasEntityFilter =
      query.companyId !== undefined || query.opportunityId !== undefined;

    let where: Prisma.ActivityWhereInput;
    if (hasEntityFilter) {
      await this.assertEntityVisible(tx, membership, query);
      // Ver visível a Company/Opportunity não bastava (pedido direto do
      // usuário, 2026-08-06): quando duas pessoas trabalham a MESMA
      // empresa/oportunidade (cada uma com seu próprio vínculo — ex.: dois
      // representantes com oportunidades próprias na mesma company), a
      // Timeline mostrava o histórico de registro manual de TODOS,
      // vazando anotação/ligação/etc. de um representante pro outro.
      // Mesmo escopo por ator que o feed "sem filtro" abaixo já aplicava
      // — owner/admin/manager (+hierarquia) veem tudo, sales_rep só o que
      // ele mesmo registrou (`actorUserId`).
      const scope = await this.policy.scopeFilter(tx, membership);
      where = {
        workspaceId: membership.workspaceId,
        companyId: query.companyId,
        opportunityId: query.opportunityId,
        ...(scope.ownerUserId !== undefined
          ? { actorUserId: scope.ownerUserId }
          : {}),
      };
    } else {
      // Sem companyId/opportunityId: feed "últimas atividades" do
      // workspace inteiro (Painel comercial, fora do SPEC-CRM-GAMA.md
      // original) — `activities` não tem RLS por papel (só isolamento de
      // workspace, é "área comum" na tabela em si), então o escopo por
      // ownership precisa ser feito aqui na app, igual Company/
      // Opportunity/Task.findAll (Fatia 9): owner/admin/manager (+
      // hierarquia) enxergam tudo; sales_rep só o que é dele via a
      // company/opportunity referenciada.
      const scope = await this.policy.scopeFilter(tx, membership);
      where = {
        workspaceId: membership.workspaceId,
        ...(scope.ownerUserId !== undefined
          ? {
              OR: [
                { company: { is: { ownerUserId: scope.ownerUserId } } },
                { opportunity: { is: { ownerUserId: scope.ownerUserId } } },
              ],
            }
          : {}),
      };
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await Promise.all([
      tx.activity.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { occurredAt: 'desc' },
      }),
      tx.activity.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // A visibilidade da timeline segue a visibilidade da entidade
  // referenciada — repete a mesma checagem pontual que Company/
  // OpportunityService já fazem (não reusa os services diretamente pra
  // não criar import circular com ActivityModule, que eles já importam
  // pra escrita).
  private async assertEntityVisible(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListActivitiesQueryDto,
  ): Promise<void> {
    // Defesa em profundidade independente do @ExactlyOneOf do DTO: como
    // esse campo é @IsOptional(), class-validator PULA o decorator
    // ExactlyOneOf inteiro quando o campo decorado está ausente — cobre
    // bem o caso "2 de 3" (o campo decorado não está undefined), mas
    // nunca pega o caso "0 de 3" (todos undefined, todos os decorators
    // pulados). Mesmo problema existiria em CreateTaskDto se não fosse a
    // checagem equivalente em TaskService.mustTargetExist.
    const targets = [query.companyId, query.opportunityId].filter(
      (value) => value !== undefined,
    );
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Exatamente um de companyId/opportunityId deve ser informado.',
      );
    }

    if (query.companyId) {
      const company = await tx.company.findFirst({
        where: { id: query.companyId, workspaceId: membership.workspaceId },
      });
      if (
        !company ||
        company.deletedAt ||
        !(await this.policy.can(
          tx,
          membership,
          'read',
          company,
          'empresas_cadastro',
        ))
      ) {
        throw new NotFoundException('Empresa não encontrada.');
      }
      // Aba Timeline da ficha da empresa — permissão própria (2026-08-12),
      // além de conseguir VER a empresa em si (empresas_cadastro acima).
      if (!this.policy.canModule(membership, 'empresas_timeline', 'ver')) {
        throw new ForbiddenException(
          'Sem permissão para ver a timeline desta empresa.',
        );
      }
      return;
    }
    if (query.opportunityId) {
      const opportunity = await tx.opportunity.findFirst({
        where: {
          id: query.opportunityId,
          workspaceId: membership.workspaceId,
        },
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
    }
  }
}
