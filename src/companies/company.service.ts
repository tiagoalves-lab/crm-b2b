import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Company } from '@prisma/client';
import { assertActiveMembership } from '../common/assert-active-membership';
import type { ListQueryDto } from '../common/dto/list-query.dto';
import {
  resolveRazaoSocial,
  sanitizeRazaoSocial,
} from '../common/sanitize-razao-social';
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

// Uma linha da tela de Empresas, já pronta (2026-09-04, etapa 3 da
// performance). Antes a tela montava isto no servidor da Vercel a partir
// de 6 requisições: as 4 páginas de `GET /companies` (81 KB cada, com
// endereço, e-mails, telefones e customFields que a tabela não mostra),
// mais `GET /opportunities` e `GET /sales-history` inteiros (1.093 vendas)
// só pra somar LTV e achar a última compra. Agora é uma requisição só,
// com os campos que a tabela desenha e as somas feitas pelo banco.
//
// Sem paginação de propósito: a tela ordena, filtra e conta no navegador,
// então precisa da lista completa de qualquer jeito (hoje 395 empresas,
// ~150 KB). Se a base crescer muito, o caminho é ordenar/filtrar no
// backend — não paginar isto aqui e remontar no frontend.
export interface CompanyResumo {
  id: string;
  razaoSocial: string | null;
  fantasia: string | null;
  nomeParaContato: string | null;
  cpfCnpj: string | null;
  cidade: string | null;
  uf: string | null;
  tags: string[];
  curvaAbc: Company['curvaAbc'];
  curvaAbcCalculadaEm: Date | null;
  deletedAt: Date | null;
  // Coluna "integração eGestor" — só existe/não existe, igual ao que
  // CompanyWithEgestor já entregava.
  temEgestor: boolean;
  ltv: number;
  ultimaCompra: string | null;
}

interface FaturamentoDaEmpresa {
  ltv: number;
  ultimaCompra: string | null;
}

const RESUMO_SELECT = {
  id: true,
  razaoSocial: true,
  fantasia: true,
  nomeParaContato: true,
  cpfCnpj: true,
  cidade: true,
  uf: true,
  tags: true,
  curvaAbc: true,
  curvaAbcCalculadaEm: true,
  deletedAt: true,
  egestorContato: { select: { id: true } },
} satisfies Prisma.CompanySelect;

// `egestorContato` não-nulo = a empresa tem vínculo com o eGestor (Matriz
// e/ou Filial) — coluna "integração" da tela de Empresas (S2.4,
// docs/roadmap.md). Só o id importa pro frontend (basta
// saber se existe), sem expor o payload cru da tabela espelho aqui.
export type CompanyWithEgestor = Company & {
  egestorContato: { id: string } | null;
};

// Retorno da busca por CNPJ — mesmos nomes de campo de CreateCompanyDto
// pros campos de cadastro (pra o frontend poder jogar isto direto no form
// sem remapear nada), mais os campos "só leitura" que a ficha da empresa
// exibe no card da Receita (situação/CNAE/porte/natureza jurídica —
// SPEC-CRM-GAMA.md §4.1, cad-grid do protótipo). Esses últimos não têm
// coluna própria em Company; o chamador decide se guarda em customFields.
export interface CnpjLookupResult {
  razaoSocial?: string;
  // Detectado e removido de razaoSocial acima — ver
  // src/common/sanitize-razao-social.ts. Sempre presente (mesmo `false`),
  // pra quem chamar poder repassar o hint direto pra createCompany/
  // updateCompany em vez de o service ter que redetectar num texto que já
  // chega limpo daqui.
  emRecuperacaoJudicial: boolean;
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
// Tabela de situação cadastral da Receita Federal — usada só como
// fallback (a BrasilAPI já manda `descricao_situacao_cadastral` pronta).
const SITUACAO_CADASTRAL_POR_CODIGO: Record<number, string | undefined> = {
  1: 'NULA',
  2: 'ATIVA',
  3: 'SUSPENSA',
  4: 'INAPTA',
  8: 'BAIXADA',
};

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
  // Código numérico (2 = ATIVA) — o texto vem em
  // `descricao_situacao_cadastral`, ver o mapeamento em lookupCnpj.
  situacao_cadastral?: number;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  porte?: string;
  descricao_porte?: string;
  natureza_juridica?: string;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  cnaes_secundarios?: Array<{ codigo?: number; descricao?: string }>;
  descricao_identificador_matriz_filial?: string;
}

// Timeline da empresa é registro de RELACIONAMENTO, não log técnico
// (decisão do usuário, 2026-09-04): só ação humana entra. Carga em massa
// e preenchimento automático passam `semTimeline: true` e não deixam
// rastro na ficha — antes uma importação de planilha escrevia "cadastro
// criado" em centenas de empresas de uma vez (870 linhas em produção) e a
// sanitização em lote pelo Cartão CNPJ escrevia "cadastro atualizado" em
// mais 302, afogando as anotações de verdade.
//
// Quem chama continua sendo auditável fora da Timeline: importação
// devolve o resumo por linha, o eGestor tem EgestorInteractionLog e o
// webhook tem EgestorWebhookEvent.
export interface SemTimeline {
  semTimeline?: boolean;
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
    options: SemTimeline = {},
  ): Promise<Company> {
    if (!this.policy.canModule(membership, 'empresas_cadastro', 'criar')) {
      throw new ForbiddenException('Sem permissão para cadastrar empresas.');
    }

    // Empresa cadastrada em duplicidade por outro representante (pedido
    // direto do usuário, 2026-08-06 — exemplo dado: Lauro cadastra
    // "Empresa Modelo", depois Darlã também cadastra a mesma empresa).
    // NÃO duplica o registro — reaproveita a Company existente.
    // ownerUserId original não muda; o segundo representante ganha
    // visão do PERFIL via CompanyAccess (ver attachToExisting/RLS da
    // migration 20260806190000) — histórico (Activity), tarefas,
    // oportunidades e contatos continuam privados de quem os criou,
    // sem nenhuma mudança nessas tabelas por causa disto.
    const cpfCnpjDigits = dto.cpfCnpj?.replace(/\D/g, '');
    if (cpfCnpjDigits) {
      // RLS de "companies" (Fatia 9) bloqueia um representante de ENXERGAR
      // company de outro dono via SELECT normal — então uma checagem
      // comum sob a sessão dele sempre voltaria vazia mesmo quando o
      // registro existe (falso negativo, geraria duplicata). A function
      // SECURITY DEFINER bypassa RLS só pra essa checagem pontual,
      // devolvendo só o id (nunca dado do cadastro), sempre escopada por
      // workspace — ver comentário completo na migration.
      const rows = await tx.$queryRaw<Array<{ id: string | null }>>(
        Prisma.sql`SELECT public.find_company_id_by_cnpj(${membership.workspaceId}::uuid, ${cpfCnpjDigits}) AS id`,
      );
      const existingId = rows[0]?.id;
      if (existingId) {
        return this.attachToExisting(tx, membership, existingId);
      }
    }

    const ownerUserId = dto.ownerUserId ?? membership.userId;
    await assertActiveMembership(tx, membership.workspaceId, ownerUserId);

    if (dto.parentCompanyId) {
      await this.mustExist(tx, membership.workspaceId, dto.parentCompanyId);
    }

    // Extrai "EM RECUPERAÇÃO JUDICIAL" da razão social pra um flag próprio
    // (ver src/common/sanitize-razao-social.ts) — só quando razaoSocial
    // vem preenchida (empresa pode nascer só com fantasia).
    const razao =
      dto.razaoSocial !== undefined
        ? resolveRazaoSocial(dto.razaoSocial, dto.emRecuperacaoJudicial)
        : undefined;

    const company = await tx.company.create({
      data: {
        workspaceId: membership.workspaceId,
        domain: dto.domain,
        industry: dto.industry,
        size: dto.size,
        ownerUserId,
        parentCompanyId: dto.parentCompanyId,
        customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
        razaoSocial: razao?.razaoSocial,
        emRecuperacaoJudicial: razao?.emRecuperacaoJudicial,
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

    if (!options.semTimeline) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: { action: 'created' },
        companyId: company.id,
      });
    }

    return company;
  }

  // Chamado só pelo caminho de dedupe do create() acima — concede ao
  // representante atual visão do PERFIL da company já existente
  // (CompanyAccess, ver RLS da migration 20260806190000) sem tocar no
  // ownerUserId original nem em nenhum dado da company. `upsert` porque
  // o mesmo representante pode "recadastrar" o mesmo CNPJ mais de uma vez
  // (ex.: reimportar planilha) — idempotente, sem erro de unique
  // constraint na segunda vez.
  private async attachToExisting(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
  ): Promise<Company> {
    await tx.companyAccess.upsert({
      where: { companyId_userId: { companyId, userId: membership.userId } },
      create: {
        workspaceId: membership.workspaceId,
        companyId,
        userId: membership.userId,
      },
      update: {},
    });

    const company = await tx.company.findFirst({
      where: { id: companyId, workspaceId: membership.workspaceId },
    });
    if (!company) {
      // Não deveria acontecer — acabamos de conceder o próprio acesso —,
      // mas defesa em profundidade caso a RLS bloqueie por outro motivo.
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListQueryDto,
  ): Promise<PaginatedResult<CompanyWithEgestor>> {
    if (!this.policy.canModule(membership, 'empresas_cadastro', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver empresas.');
    }
    const visibilityWhere = await this.policy.companyReadFilter(tx, membership);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CompanyWhereInput = {
      workspaceId: membership.workspaceId,
      ...visibilityWhere,
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
        // Coluna "integração eGestor" (S2.4, docs/roadmap.md)
        // — só o id basta, o frontend só precisa saber se é null ou não.
        include: { egestorContato: { select: { id: true } } },
      }),
      tx.company.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // Tela de Empresas inteira numa requisição — ver CompanyResumo.
  async resumoParaLista(
    tx: TenantTx,
    membership: MembershipContext,
    includeDeleted: boolean,
  ): Promise<{ items: CompanyResumo[]; total: number }> {
    if (!this.policy.canModule(membership, 'empresas_cadastro', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver empresas.');
    }
    const visibilityWhere = await this.policy.companyReadFilter(tx, membership);
    const where: Prisma.CompanyWhereInput = {
      workspaceId: membership.workspaceId,
      ...visibilityWhere,
      deletedAt: includeDeleted ? undefined : null,
      // Mesmo recorte de findAll: lead em triagem não é empresa ainda.
      NOT: { tags: { has: 'lead-triagem' } },
    };

    // Faturamento tem permissão própria — mesma régua de
    // SalesHistoryService#findAll. Quem não pode ver vendas recebe a lista
    // com LTV/última compra vazios, em vez de 403 na tela inteira (que é o
    // que acontecia antes: a página chamava GET /sales-history direto e
    // quebrava por inteiro pra quem não tinha a permissão).
    const podeVerFaturamento =
      this.policy.canModule(membership, 'empresas_vendas', 'ver') ||
      this.policy.canModule(membership, 'empresas_posvenda', 'ver');

    const [companies, faturamento] = await Promise.all([
      tx.company.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: RESUMO_SELECT,
      }),
      podeVerFaturamento
        ? this.agregarFaturamento(tx, membership)
        : Promise.resolve(new Map<string, FaturamentoDaEmpresa>()),
    ]);

    const items = companies.map(({ egestorContato, ...c }) => {
      const stats = faturamento.get(c.id);
      return {
        ...c,
        temEgestor: egestorContato !== null,
        ltv: stats?.ltv ?? 0,
        ultimaCompra: stats?.ultimaCompra ?? null,
      };
    });

    return { items, total: items.length };
  }

  // LTV e última compra somados PELO BANCO, um group by cada. LTV =
  // oportunidade ganha (pipeline novo) + histórico de vendas do eGestor —
  // mesma conta que a tela fazia em JavaScript depois de baixar as duas
  // listas inteiras.
  private async agregarFaturamento(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<Map<string, FaturamentoDaEmpresa>> {
    // Oportunidade respeita o escopo por dono (scopeFilter), igual a
    // GET /opportunities: manager continua somando só o time dele, e não
    // o workspace inteiro. Histórico de vendas não tem dono (importado do
    // eGestor) — quem controla ali é só a permissão de módulo acima.
    const ownerFilter = await this.policy.scopeFilter(tx, membership);

    const [vendas, ganhas] = await Promise.all([
      tx.salesHistory.groupBy({
        by: ['companyId'],
        where: { workspaceId: membership.workspaceId },
        _sum: { valorTotal: true },
        _max: { dtVenda: true },
      }),
      tx.opportunity.groupBy({
        by: ['companyId'],
        where: {
          workspaceId: membership.workspaceId,
          ...ownerFilter,
          status: 'won',
          deletedAt: null,
        },
        _sum: { amount: true },
        _max: { closedAt: true },
      }),
    ]);

    const mapa = new Map<string, FaturamentoDaEmpresa>();
    const acumular = (
      companyId: string,
      valor: Prisma.Decimal | null,
      data: Date | null,
    ) => {
      const atual = mapa.get(companyId) ?? { ltv: 0, ultimaCompra: null };
      atual.ltv += valor ? Number(valor) : 0;
      const iso = data ? data.toISOString() : null;
      if (iso && (!atual.ultimaCompra || iso > atual.ultimaCompra)) {
        atual.ultimaCompra = iso;
      }
      mapa.set(companyId, atual);
    };

    for (const v of vendas) {
      acumular(v.companyId, v._sum.valorTotal, v._max.dtVenda);
    }
    for (const o of ganhas) {
      acumular(o.companyId, o._sum.amount, o._max.closedAt);
    }
    return mapa;
  }

  async findOne(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<CompanyWithEgestor> {
    return this.mustBeVisible(tx, membership, id);
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateCompanyDto,
    options: SemTimeline = {},
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

    // Mesma extração do create() acima — só quando razaoSocial vem no
    // update (undefined = campo não tocado, preserva o que já existia).
    const razao =
      dto.razaoSocial !== undefined
        ? resolveRazaoSocial(dto.razaoSocial, dto.emRecuperacaoJudicial)
        : undefined;

    const updated = await tx.company.update({
      where: { id: existing.id },
      data: {
        domain: dto.domain,
        industry: dto.industry,
        size: dto.size,
        ownerUserId: dto.ownerUserId,
        parentCompanyId: dto.parentCompanyId,
        customFields: dto.customFields as Prisma.InputJsonValue | undefined,
        razaoSocial: razao?.razaoSocial,
        emRecuperacaoJudicial: razao?.emRecuperacaoJudicial,
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

    if (!options.semTimeline) {
      await this.activities.emit(tx, {
        workspaceId: membership.workspaceId,
        actorUserId: membership.userId,
        type: 'field_update',
        payload: { action: 'updated', fields: Object.keys(dto) },
        companyId: updated.id,
      });
    }

    return updated;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Company> {
    const existing = await this.mustBeVisible(tx, membership, id, 'delete');

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
    if (
      !(await this.policy.can(
        tx,
        membership,
        'write',
        existing,
        'empresas_cadastro',
      ))
    ) {
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
    const response = await fetch(
      `https://brasilapi.com.br/api/cnpj/v1/${digits}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (compatible; CRM-Gama-Brasil/1.0; +https://web-gamma-olive-80.vercel.app)',
        },
      },
    );
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
          ? String(body.message)
          : 'Não foi possível consultar o CNPJ agora — tente novamente em instantes.';
      throw new BadRequestException(message);
    }

    const data = (await response.json()) as BrasilApiCnpjResponse;

    // Trata o indicativo "EM RECUPERAÇÃO JUDICIAL" direto na resposta da
    // consulta de CNPJ (pedido do usuário: "na requisição da API") — quem
    // chama recebe a razão social já limpa + o flag pra repassar como hint
    // a createCompany/updateCompany (ver CreateCompanyDto#emRecuperacaoJudicial).
    const razao = data.razao_social
      ? sanitizeRazaoSocial(data.razao_social)
      : undefined;

    return {
      razaoSocial: razao?.razaoSocial,
      emRecuperacaoJudicial: razao?.emRecuperacaoJudicial ?? false,
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
      // `situacao_cadastral` é o CÓDIGO numérico da Receita (2 = ATIVA);
      // quem tem o texto é `descricao_situacao_cadastral` — confirmado
      // contra a resposta real da BrasilAPI em 2026-08-19. Gravar o código
      // fazia a ficha mostrar "2" e pintar o selo de vermelho (a tela
      // compara com "ATIVA"), ou seja: toda empresa ativa aparecia como se
      // não fosse. Fallback pelo código só pra não voltar a mostrar número
      // cru se a API parar de mandar a descrição.
      situacaoCadastral:
        data.descricao_situacao_cadastral ??
        SITUACAO_CADASTRAL_POR_CODIGO[Number(data.situacao_cadastral)],
      dataAbertura: data.data_inicio_atividade,
      porte: data.descricao_porte ?? data.porte,
      naturezaJuridica: data.natureza_juridica,
      cnaePrincipal:
        data.cnae_fiscal != null
          ? `${data.cnae_fiscal}${data.cnae_fiscal_descricao ? ` - ${data.cnae_fiscal_descricao}` : ''}`
          : undefined,
      cnaeSecundarios: (data.cnaes_secundarios ?? [])
        .filter((c) => c.codigo != null || c.descricao)
        .map((c) =>
          `${c.codigo ?? ''}${c.descricao ? ` - ${c.descricao}` : ''}`.trim(),
        ),
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
  //
  // Company tem visibilidade de LEITURA mais larga que PolicyService.can()
  // conhece (esse só sabe de ownerUserId direto/hierarquia de manager):
  // uma oportunidade própria na empresa (regra original do SPEC-CRM-GAMA.md
  // §7.5) ou um CompanyAccess concedido (empresa compartilhada, pedido do
  // usuário 2026-08-06, ver create()/attachToExisting() acima) TAMBÉM dão
  // acesso ao PERFIL — por isso o ramo 'read' usa PolicyService.
  // canReadCompany() (mesma regra da lista e da Timeline, ver
  // companyReadFilter() lá) em vez de policy.can() puro. Escrita (editar/
  // excluir o cadastro em si)
  // continua restrita ao critério clássico — CompanyAccess/oportunidade não
  // fazem o segundo representante virar dono do cadastro.
  private async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' | 'delete' = 'read',
  ): Promise<CompanyWithEgestor> {
    const company = await tx.company.findFirst({
      where: { id, workspaceId: membership.workspaceId },
      include: { egestorContato: { select: { id: true } } },
    });
    if (!company || company.deletedAt) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    if (action === 'write' || action === 'delete') {
      if (
        !(await this.policy.can(
          tx,
          membership,
          action,
          company,
          'empresas_cadastro',
        ))
      ) {
        throw new NotFoundException('Empresa não encontrada.');
      }
      return company;
    }

    if (!(await this.policy.canReadCompany(tx, membership, company.id))) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }

  // A regra de visibilidade de leitura (mesma pra findAll e mustBeVisible)
  // mora em PolicyService.companyReadFilter()/canReadCompany() desde
  // 2026-09-02 — a Timeline (ActivityQueryService/ActivityService) também
  // precisa dela, e ficar aqui obrigava a duplicar (foi o que fez a ficha
  // quebrar pra manager).
}
