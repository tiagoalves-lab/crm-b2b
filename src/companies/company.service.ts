import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Company, Prisma } from '@prisma/client';
import { assertActiveMembership } from '../common/assert-active-membership';
import type { ListQueryDto } from '../common/dto/list-query.dto';
import { ActivityService } from '../activities/activity.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateCompanyDto } from './dto/create-company.dto';
import type { UpdateCompanyDto } from './dto/update-company.dto';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Retorno da busca por CNPJ — mesmos nomes de campo de CreateCompanyDto
// pros campos de cadastro (pra o frontend poder jogar isto direto no form
// sem remapear nada), mais os campos "só leitura" que a ficha da empresa
// exibe no card da Receita (situação/CNAE/porte/natureza jurídica —
// SPEC-CRM-GAMA.md §4.1, cad-grid do protótipo). Esses últimos não têm
// coluna própria em Company; o chamador decide se guarda em customFields.
export interface CnpjLookupResult {
  razaoSocial?: string;
  fantasia?: string;
  cpfCnpj: string;
  tipo: 'PJ';
  emails: string[];
  fones: string[];
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  situacaoCadastral?: string;
  dataAbertura?: string;
  porte?: string;
  naturezaJuridica?: string;
  cnaePrincipal?: string;
  cnaeSecundarios?: string[];
  estabelecimento?: string;
}

// Formato de resposta da BrasilAPI (https://brasilapi.com.br/api/cnpj/v1) —
// só os campos que a gente de fato usa, o resto da resposta é ignorado.
interface BrasilApiCnpjResponse {
  razao_social?: string;
  nome_fantasia?: string;
  email?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  situacao_cadastral?: string;
  data_inicio_atividade?: string;
  porte?: string;
  descricao_porte?: string;
  natureza_juridica?: string;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  cnaes_secundarios?: Array<{ codigo?: number; descricao?: string }>;
  descricao_identificador_matriz_filial?: string;
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly policy: PolicyService,
    private readonly activities: ActivityService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateCompanyDto,
  ): Promise<Company> {
    const ownerUserId = dto.ownerUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, ownerUserId);

    if (dto.parentCompanyId) {
      await this.mustExist(tx, membership.workspaceId, dto.parentCompanyId);
    }

    const company = await tx.company.create({
      data: {
        workspaceId: membership.workspaceId,
        domain: dto.domain,
        industry: dto.industry,
        size: dto.size,
        ownerUserId,
        parentCompanyId: dto.parentCompanyId,
        customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
        razaoSocial: dto.razaoSocial,
        fantasia: dto.fantasia,
        nomeParaContato: dto.nomeParaContato,
        cpfCnpj: dto.cpfCnpj,
        tipo: dto.tipo,
        dtNasc: dto.dtNasc ? new Date(dto.dtNasc) : undefined,
        dtCad: dto.dtCad ? new Date(dto.dtCad) : undefined,
        emails: dto.emails ?? [],
        fones: dto.fones ?? [],
        logradouro: dto.logradouro,
        numero: dto.numero,
        complemento: dto.complemento,
        bairro: dto.bairro,
        cep: dto.cep,
        cidade: dto.cidade,
        uf: dto.uf,
        tags: dto.tags ?? [],
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'created' },
      companyId: company.id,
    });

    return company;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListQueryDto,
  ): Promise<PaginatedResult<Company>> {
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      workspaceId: membership.workspaceId,
      ...ownerFilter,
      deletedAt: query.includeDeleted ? undefined : null,
      // Company-lead ainda em triagem (tag "lead-triagem", SPEC-CRM-GAMA.md
      // §4.4) não é uma empresa de verdade até ser aprovada — mesmo
      // critério de exclusão que a view v_busca_empresa_lead já aplica.
      // Precisa ser filtro de query (não só no frontend, como antes):
      // orderBy createdAt desc + paginação faz a leva mais recente de
      // triagem (import em massa) lotar a 1ª página inteira, deixando as
      // empresas de verdade só na 2ª página em diante — a tela de
      // Empresas nunca busca além da 1ª (pageSize fixo), então sumiam da
      // lista mesmo existindo no banco.
      NOT: { tags: { has: 'lead-triagem' } },
    };

    const [items, total] = await Promise.all([
      tx.company.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      tx.company.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    return this.mustBeVisible(tx, membership, id);
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateCompanyDto,
  ): Promise<Company> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    if (dto.ownerUserId) {
      await assertActiveMembership(tx, membership.workspaceId, dto.ownerUserId);
    }
    if (dto.parentCompanyId) {
      if (dto.parentCompanyId === id) {
        throw new BadRequestException(
          'Uma empresa não pode ser sua própria matriz.',
        );
      }
      await this.mustExist(tx, membership.workspaceId, dto.parentCompanyId);
    }

    const updated = await tx.company.update({
      where: { id: existing.id },
      data: {
        domain: dto.domain,
        industry: dto.industry,
        size: dto.size,
        ownerUserId: dto.ownerUserId,
        parentCompanyId: dto.parentCompanyId,
        customFields: dto.customFields as Prisma.InputJsonValue | undefined,
        razaoSocial: dto.razaoSocial,
        fantasia: dto.fantasia,
        nomeParaContato: dto.nomeParaContato,
        cpfCnpj: dto.cpfCnpj,
        tipo: dto.tipo,
        dtNasc: dto.dtNasc ? new Date(dto.dtNasc) : undefined,
        dtCad: dto.dtCad ? new Date(dto.dtCad) : undefined,
        emails: dto.emails,
        fones: dto.fones,
        logradouro: dto.logradouro,
        numero: dto.numero,
        complemento: dto.complemento,
        bairro: dto.bairro,
        cep: dto.cep,
        cidade: dto.cidade,
        uf: dto.uf,
        tags: dto.tags,
      },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'updated', fields: Object.keys(dto) },
      companyId: updated.id,
    });

    return updated;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    const existing = await this.mustBeVisible(tx, membership, id, 'write');

    const deleted = await tx.company.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'deleted' },
      companyId: deleted.id,
    });

    return deleted;
  }

  async restore(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    const existing = await tx.company.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!existing) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    if (!(await this.policy.can(tx, membership, 'write', existing))) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    if (!existing.deletedAt) {
      throw new BadRequestException('Empresa não está excluída.');
    }

    const restored = await tx.company.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'restored' },
      companyId: restored.id,
    });

    return restored;
  }

  // Consulta pública (sem chave/custo) da Receita Federal via BrasilAPI —
  // não existe API unificada de SEFAZ pra dado cadastral de CNPJ (SEFAZ é
  // por estado, sem padrão comum); o que devolve razão social/fantasia/
  // endereço é a base da Receita, que é o que BrasilAPI espelha. Só busca
  // e devolve o dado mapeado — não cria/atualiza nada, quem decide se usa
  // é o chamador (form no frontend).
  async lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
    const digits = cnpj.replace(/\D/g, '');
    if (digits.length !== 14) {
      throw new BadRequestException('CNPJ precisa ter 14 dígitos.');
    }

    // Sem User-Agent/Accept, o fetch parece tráfego de bot anônimo — a
    // proteção do Vercel/Cloudflare na frente da BrasilAPI bloqueia com
    // 403 (`x-vercel-mitigated: deny`) antes mesmo de chegar na API de
    // verdade. Descoberto rodando de dentro do Railway (2026-08-01) — de
    // fora (curl local) o mesmo CNPJ respondia 200 normalmente.
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (compatible; CRM-Gama-Brasil/1.0; +https://web-gamma-olive-80.vercel.app)',
      },
    });
    if (response.status === 404) {
      throw new NotFoundException(`CNPJ "${digits}" não encontrado.`);
    }
    if (!response.ok) {
      // BrasilAPI manda um `message` específico (ex.: "CNPJ 11.111.111/1111-11
      // inválido." quando o dígito verificador não bate) — repassa em vez de
      // esconder atrás de um texto genérico, senão "CNPJ digitado errado"
      // parece erro de infra e ninguém sabe o que corrigir.
      const body: unknown = await response.json().catch(() => null);
      const message =
        body && typeof body === 'object' && 'message' in body
          ? String((body as { message: unknown }).message)
          : 'Não foi possível consultar o CNPJ agora — tente novamente em instantes.';
      throw new BadRequestException(message);
    }

    const data = (await response.json()) as BrasilApiCnpjResponse;

    return {
      razaoSocial: data.razao_social,
      fantasia: data.nome_fantasia,
      cpfCnpj: digits,
      tipo: 'PJ',
      emails: data.email ? [data.email] : [],
      fones: [data.ddd_telefone_1, data.ddd_telefone_2].filter(
        (value): value is string => !!value,
      ),
      logradouro: data.logradouro,
      numero: data.numero,
      complemento: data.complemento,
      bairro: data.bairro,
      cep: data.cep,
      cidade: data.municipio,
      uf: data.uf,
      situacaoCadastral: data.situacao_cadastral,
      dataAbertura: data.data_inicio_atividade,
      porte: data.descricao_porte ?? data.porte,
      naturezaJuridica: data.natureza_juridica,
      cnaePrincipal:
        data.cnae_fiscal != null
          ? `${data.cnae_fiscal}${data.cnae_fiscal_descricao ? ` - ${data.cnae_fiscal_descricao}` : ''}`
          : undefined,
      cnaeSecundarios: (data.cnaes_secundarios ?? [])
        .filter((c) => c.codigo != null || c.descricao)
        .map((c) => `${c.codigo ?? ''}${c.descricao ? ` - ${c.descricao}` : ''}`.trim()),
      estabelecimento: data.descricao_identificador_matriz_filial,
    };
  }

  private async mustExist(
    tx: TenantTx,
    workspaceId: string,
    id: string,
  ): Promise<Company> {
    const company = await tx.company.findFirst({
      where: { id, workspaceId },
    });
    if (!company || company.deletedAt) {
      throw new BadRequestException(`Empresa "${id}" não encontrada.`);
    }
    return company;
  }

  // 404 (não 403) quando a policy nega — não confirma pra quem não tem
  // acesso que o registro existe no workspace, mesmo escopo de
  // PolicyService.scopeFilter (que simplesmente omite o registro da lista).
  private async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' = 'read',
  ): Promise<Company> {
    const company = await tx.company.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    if (!(await this.policy.can(tx, membership, action, company))) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }
}
