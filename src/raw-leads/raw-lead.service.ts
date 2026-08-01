import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Company, Prisma, RawLead } from '@prisma/client';
import type { PaginatedResult } from '../companies/company.service';
import { CompanyService } from '../companies/company.service';
import type { CreateCompanyDto } from '../companies/dto/create-company.dto';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateRawLeadDto } from './dto/create-raw-lead.dto';
import type { ListRawLeadsQueryDto } from './dto/list-raw-leads-query.dto';
import { LeadScoringService } from './lead-scoring.service';

export interface BulkResult {
  ok: string[];
  failed: Array<{ id: string; reason: string }>;
}

// Módulo de Leads/Triagem (SPEC-CRM-GAMA.md §4.4). Decisão de modelagem
// central: a company-lead nasce JUNTO com o raw_lead (tag "lead-triagem"),
// não só no momento da aprovação — assim activities/tasks já se ligam a um
// company_id real desde o primeiro contato na triagem, e "aprovar" nunca
// precisa migrar histórico, só remover a tag (ver approve() abaixo).
@Injectable()
export class RawLeadService {
  constructor(
    private readonly scoring: LeadScoringService,
    private readonly companies: CompanyService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateRawLeadDto,
  ): Promise<RawLead> {
    const importador = dto.importador ?? false;
    const { score } = this.scoring.score({
      cnaePrincipal: dto.cnaePrincipal,
      importador,
      porte: dto.porte,
      situacao: dto.situacao,
      uf: dto.uf,
    });

    // CreateCompanyDto é só o shape de entrada do service — construído
    // aqui em memória (não vem de HTTP/ValidationPipe), mesmo padrão de
    // reuso interno já usado por outros services do projeto.
    const companyDto: CreateCompanyDto = {
      razaoSocial: dto.razaoSocial,
      cpfCnpj: dto.cnpj,
      tipo: 'PJ',
      cidade: dto.municipio,
      uf: dto.uf,
      tags: ['lead-triagem'],
    };
    const company = await this.companies.create(tx, membership, companyDto);

    return tx.rawLead.create({
      data: {
        workspaceId: membership.workspaceId,
        razaoSocial: dto.razaoSocial,
        cnpj: dto.cnpj,
        cnaePrincipal: dto.cnaePrincipal,
        cnaeDescricao: dto.cnaeDescricao,
        porte: dto.porte,
        uf: dto.uf,
        municipio: dto.municipio,
        situacao: dto.situacao,
        importador,
        fonte: dto.fonte ?? 'manual',
        score,
        promotedCompanyId: company.id,
      },
    });
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListRawLeadsQueryDto,
  ): Promise<PaginatedResult<RawLead>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const status = query.status ?? 'novo';
    const scoreRange = this.tierRange(query.tier);

    const where: Prisma.RawLeadWhereInput = {
      workspaceId: membership.workspaceId,
      status,
      ...(scoreRange ? { score: scoreRange } : {}),
      ...(query.q
        ? {
            OR: [
              { razaoSocial: { contains: query.q, mode: 'insensitive' } },
              { cnaePrincipal: { contains: query.q, mode: 'insensitive' } },
              { cnaeDescricao: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      tx.rawLead.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { score: 'desc' },
      }),
      tx.rawLead.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<RawLead> {
    return this.mustExist(tx, membership.workspaceId, id);
  }

  // A company já existe desde a importação do lead (criada com a tag
  // "lead-triagem", ver §4.4) — aprovar não recria nada, só remove o
  // marcador de triagem + marca o lead como aprovado. Histórico
  // (activities/tasks já ligados a essa company) nunca migra.
  async approve(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    const lead = await this.mustBeNovo(tx, membership.workspaceId, id);
    if (!lead.promotedCompanyId) {
      throw new BadRequestException(
        'Lead sem empresa associada — não pode ser aprovado.',
      );
    }

    const company = await tx.company.findFirst({
      where: {
        id: lead.promotedCompanyId,
        workspaceId: membership.workspaceId,
      },
    });
    if (!company) {
      throw new NotFoundException('Empresa do lead não encontrada.');
    }

    await tx.rawLead.update({
      where: { id: lead.id },
      data: { status: 'aprovado' },
    });

    return tx.company.update({
      where: { id: company.id },
      data: { tags: company.tags.filter((t) => t !== 'lead-triagem') },
    });
  }

  // Decisão registrada (usuário, 2026-07-31): descartar NÃO apaga nem
  // soft-deleta a company-lead — ela fica intacta no banco, só invisível
  // (segue com a tag lead-triagem, então nunca aparece em Empresas nem em
  // v_busca_empresa_lead). Reversível: nada se perde se o lead for
  // reconsiderado depois.
  async discard(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<RawLead> {
    const lead = await this.mustBeNovo(tx, membership.workspaceId, id);
    return tx.rawLead.update({
      where: { id: lead.id },
      data: { status: 'descartado' },
    });
  }

  async bulkApprove(
    tx: TenantTx,
    membership: MembershipContext,
    ids: string[],
  ): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => this.approve(tx, membership, id));
  }

  async bulkDiscard(
    tx: TenantTx,
    membership: MembershipContext,
    ids: string[],
  ): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => this.discard(tx, membership, id));
  }

  // Recalcula o score dos leads 'novo' do workspace com a fórmula atual —
  // útil se o critério de qualificação mudar depois de leads já
  // importados (protótipo expõe isso como botão "Recalcular scores").
  async rescoreAll(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<{ updated: number }> {
    const leads = await tx.rawLead.findMany({
      where: { workspaceId: membership.workspaceId, status: 'novo' },
    });

    let updated = 0;
    for (const lead of leads) {
      const { score } = this.scoring.score({
        cnaePrincipal: lead.cnaePrincipal,
        importador: lead.importador,
        porte: lead.porte,
        situacao: lead.situacao,
        uf: lead.uf,
      });
      if (score !== lead.score) {
        await tx.rawLead.update({ where: { id: lead.id }, data: { score } });
        updated++;
      }
    }
    return { updated };
  }

  private async bulkRun(
    ids: string[],
    run: (id: string) => Promise<unknown>,
  ): Promise<BulkResult> {
    const ok: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        await run(id);
        ok.push(id);
      } catch (error) {
        failed.push({
          id,
          reason: error instanceof Error ? error.message : 'Erro desconhecido.',
        });
      }
    }
    return { ok, failed };
  }

  private tierRange(
    tier: 'quente' | 'morno' | 'frio' | undefined,
  ): Prisma.IntFilter | undefined {
    if (tier === 'quente') return { gte: 70 };
    if (tier === 'morno') return { gte: 45, lt: 70 };
    if (tier === 'frio') return { lt: 45 };
    return undefined;
  }

  private async mustExist(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<RawLead> {
    const lead = await tx.rawLead.findFirst({ where: { id, workspaceId } });
    if (!lead) {
      throw new NotFoundException('Lead não encontrado.');
    }
    return lead;
  }

  private async mustBeNovo(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<RawLead> {
    const lead = await this.mustExist(tx, workspaceId, id);
    if (lead.status !== 'novo') {
      throw new BadRequestException('Lead já foi aprovado ou descartado.');
    }
    return lead;
  }
}
