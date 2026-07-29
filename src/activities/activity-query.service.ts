import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Activity } from '@prisma/client';
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
    await this.assertEntityVisible(tx, membership, query);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      workspaceId: membership.workspaceId,
      companyId: query.companyId,
      opportunityId: query.opportunityId,
    };

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
        !(await this.policy.can(tx, membership, 'read', company))
      ) {
        throw new NotFoundException('Empresa não encontrada.');
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
        !(await this.policy.can(tx, membership, 'read', opportunity))
      ) {
        throw new NotFoundException('Oportunidade não encontrada.');
      }
    }
  }
}
