import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Company, Prisma, RawLead } from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import type { PaginatedResult } from '../companies/company.service';
import { CompanyService } from '../companies/company.service';
import { ContactService } from '../companies/contact.service';
import type { CreateCompanyDto } from '../companies/dto/create-company.dto';
import { resolveRazaoSocial } from '../common/sanitize-razao-social';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { parseContactsSpreadsheet } from './contacts-spreadsheet-import.util';
import type { CreateRawLeadDto } from './dto/create-raw-lead.dto';
import type { ListRawLeadsQueryDto } from './dto/list-raw-leads-query.dto';
import type { UpdateLeadSegmentoDto } from './dto/update-lead-segmento.dto';
import type { UpdateLeadTagsDto } from './dto/update-lead-tags.dto';
import type { UpdateLeadTierDto } from './dto/update-lead-tier.dto';
import { LeadScoringService } from './lead-scoring.service';
import {
  parseLeadsSpreadsheet,
  type RowError,
} from './spreadsheet-import.util';

export interface BulkResult {
  ok: string[];
  failed: Array<{ id: string; reason: string }>;
}

export interface ImportResult {
  total: number;
  imported: number;
  errors: RowError[];
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
    private readonly contacts: ContactService,
    private readonly activities: ActivityService,
    private readonly policy: PolicyService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dtoRaw: CreateRawLeadDto,
  ): Promise<RawLead> {
    // Padroniza em caixa alta os campos de texto do cadastro (pedido do
    // usuário, 2026-08-10) — único ponto de entrada de criação de
    // lead+company, então cobre o form manual (+ Nova empresa da
    // Prospecção) E os dois caminhos de importação por planilha
    // (importSpreadsheet/importSpreadsheetWithContacts abaixo, que também
    // passam por create()), sem duplicar a normalização em cada um. Mesmo
    // escopo de campos da query retroativa em
    // scripts/uppercase-cadastros-prospeccao.sql — CNPJ/emails/telefones
    // ficam de fora (dado técnico, não texto de cadastro; email por
    // convenção fica minúsculo).
    if (!this.policy.canModule(membership, 'leads', 'criar')) {
      throw new ForbiddenException('Sem permissão para cadastrar leads.');
    }

    const dto = this.upperCaseTextFields(dtoRaw);
    const importador = dto.importador ?? false;
    const { score } = this.scoring.score({
      cnaePrincipal: dto.cnaePrincipal,
      importador,
      porte: dto.porte,
      situacao: dto.situacao,
      uf: dto.uf,
    });

    // Extrai "EM RECUPERAÇÃO JUDICIAL" da razão social pra um flag próprio
    // (ver src/common/sanitize-razao-social.ts) — uma vez só, repassado
    // tanto pra Company quanto pro RawLead, pra não redetectar a partir de
    // um texto que já pode estar limpo (mesmo cuidado de company.service.ts).
    const razao = resolveRazaoSocial(
      dto.razaoSocial,
      dto.emRecuperacaoJudicial,
    );

    // Dedupe de raw_leads por CNPJ (achado real, 2026-08-10): reimportar a
    // MESMA planilha 3x não duplicava a company (essa já dedupe por CNPJ
    // logo abaixo, via CompanyService#create/attachToExisting), mas
    // duplicava a linha de triagem — cada chamada de create() sempre
    // inserida, sem checar se já existia. Resultado real: 876 CNPJs
    // únicos viraram 2.143 linhas em raw_leads. Só considera lead 'novo'
    // — um já aprovado/descartado não deve travar nem ser tocado por uma
    // reimportação (segue o fluxo normal de criar um novo, igual antes).
    const cnpjDigits = dto.cnpj?.replace(/\D/g, '') || undefined;
    const existingLead = cnpjDigits
      ? await tx.rawLead.findFirst({
          where: {
            workspaceId: membership.workspaceId,
            cnpj: cnpjDigits,
            status: 'novo',
          },
        })
      : null;

    // CreateCompanyDto é só o shape de entrada do service — construído
    // aqui em memória (não vem de HTTP/ValidationPipe), mesmo padrão de
    // reuso interno já usado por outros services do projeto.
    const companyDto: CreateCompanyDto = {
      razaoSocial: razao.razaoSocial,
      emRecuperacaoJudicial: razao.emRecuperacaoJudicial,
      cpfCnpj: cnpjDigits ?? dto.cnpj,
      tipo: 'PJ',
      cidade: dto.municipio,
      uf: dto.uf,
      tags: ['lead-triagem'],
      fantasia: dto.fantasia,
      emails: dto.emails,
      fones: dto.fones,
      dtCad: dto.dtAbertura,
      customFields: dto.socios?.length ? { socios: dto.socios } : undefined,
    };
    const company = await this.companies.create(tx, membership, companyDto);

    const rawLeadData = {
      workspaceId: membership.workspaceId,
      razaoSocial: razao.razaoSocial,
      emRecuperacaoJudicial: razao.emRecuperacaoJudicial,
      cnpj: cnpjDigits ?? dto.cnpj,
      cnaePrincipal: dto.cnaePrincipal,
      cnaeDescricao: dto.cnaeDescricao,
      porte: dto.porte,
      uf: dto.uf,
      municipio: dto.municipio,
      situacao: dto.situacao,
      importador,
      fonte: dto.fonte ?? 'manual',
      score,
      // Mesma normalização (trim/dedupe) de setTags() — cobre tanto o
      // form manual quanto a coluna "Tags" da importação por planilha
      // (pedido do usuário, 2026-08-06: "não apareceu a coluna tag no
      // cabeçalho" do modelo padrão de importação).
      tags: this.normalizeTags(dto.tags ?? []),
      promotedCompanyId: company.id,
    };

    if (existingLead) {
      // Reimportação do mesmo CNPJ — atualiza os dados no lead existente
      // em vez de inserir outra linha. ownerUserId NÃO muda (preserva o
      // dono original, mesmo critério de CompanyService#attachToExisting
      // não alterar o ownerUserId da company já existente).
      return tx.rawLead.update({
        where: { id: existingLead.id },
        data: rawLeadData,
      });
    }

    return tx.rawLead.create({
      data: {
        ...rawLeadData,
        // Carteira do representante (pedido direto do usuário, 2026-08-06)
        // — sempre quem está autenticado no momento, nunca escolhido pelo
        // cliente (mesmo critério de Company.ownerUserId em
        // CompanyService.create). Não confundir com `company.ownerUserId`
        // acima: são o mesmo valor aqui (a company nasce junto com o lead,
        // ver comentário na classe), mas ownerUserId de RawLead é o que
        // this.findAll/mustBeVisible checam pra Prospecção.
        ownerUserId: membership.userId,
      },
    });
  }

  // Importação em massa via planilha (CSV/XLSX) — SPEC-CRM-GAMA.md §9
  // (ingestão automática do crawler), fora de escopo da rodada original
  // das 9 fatias, implementada agora a pedido direto do usuário. Reusa
  // create() linha a linha (mesmo caminho do form manual e da mesma
  // regra "company nasce junto com o raw_lead") — uma linha ruim não
  // derruba as outras, erro fica reportado por número de linha.
  async importSpreadsheet(
    tx: TenantTx,
    membership: MembershipContext,
    file: { buffer: Buffer; originalname: string },
  ): Promise<ImportResult> {
    const { rows, errors } = await parseLeadsSpreadsheet(
      file.buffer,
      file.originalname,
    );
    const total = rows.length + errors.length;

    let imported = 0;
    for (const { row, dto } of rows) {
      try {
        await this.create(tx, membership, dto);
        imported++;
      } catch (error) {
        errors.push({
          row,
          reason: error instanceof Error ? error.message : 'Erro desconhecido.',
        });
      }
    }

    return { total, imported, errors };
  }

  // Importação de planilha no MODELO PADRÃO com múltiplos contatos por
  // empresa (pedido do usuário, 2026-08-03) — diferente de importSpreadsheet
  // acima: aqui o layout é rígido (contactsSpreadsheetImportUtil rejeita
  // cabeçalho fora do template, ver validateTemplateHeaders) e cada LINHA é
  // um contato, com a empresa se repetindo pelo mesmo CNPJ em várias linhas.
  // Agrupa por CNPJ, cria a company-lead uma única vez (primeira linha do
  // grupo) e um Contact por linha — se a criação da empresa falhar, nenhum
  // contato do grupo é tentado (não faz sentido contato órfão).
  async importSpreadsheetWithContacts(
    tx: TenantTx,
    membership: MembershipContext,
    file: { buffer: Buffer; originalname: string },
  ): Promise<ImportResult> {
    const { groups, errors } = await parseContactsSpreadsheet(
      file.buffer,
      file.originalname,
    );
    const total =
      groups.reduce((acc, g) => acc + g.contacts.length, 0) + errors.length;

    let imported = 0;
    for (const group of groups) {
      const companyDto: CreateRawLeadDto = {
        razaoSocial: group.razaoSocial,
        cnpj: group.cnpj,
        cnaePrincipal: group.cnaePrincipal,
        porte: group.porte,
        uf: group.uf,
        municipio: group.municipio,
        situacao: group.situacao,
        importador: group.importador,
        fantasia: group.fantasia,
        socios: group.socios,
        tags: group.tags,
        dtAbertura: group.dtAbertura,
      };

      let lead: RawLead;
      try {
        lead = await this.create(tx, membership, companyDto);
      } catch (error) {
        errors.push({
          row: group.firstRow,
          reason: `Empresa não criada (${error instanceof Error ? error.message : 'erro desconhecido'}) — os ${group.contacts.length} contato(s) desta empresa não foram importados.`,
        });
        continue;
      }

      for (const contact of group.contacts) {
        try {
          // Dedupe por reimportação da mesma planilha (achado real,
          // 2026-08-10: reimportar 3x sem isso duplicou 2.321 linhas de
          // contato — mesma pessoa, mesmo e-mail/telefone, na mesma
          // empresa). Mesmo espírito do dedupe de RawLead por CNPJ em
          // create() acima: se já existe um contato idêntico
          // (empresa+nome+email+telefone) nesta company, pula em vez de
          // inserir de novo — conta como "importado" mesmo assim, já que
          // o resultado desejado (contato presente) já está satisfeito.
          const duplicate = await tx.contact.findFirst({
            where: {
              companyId: lead.promotedCompanyId!,
              nome: contact.nome,
              email: contact.email ?? null,
              telefone: contact.telefone ?? null,
            },
          });
          if (duplicate) {
            imported++;
            continue;
          }

          await this.contacts.create(tx, membership, lead.promotedCompanyId!, {
            nome: contact.nome,
            cargo: contact.cargo,
            email: contact.email,
            telefone: contact.telefone,
            decisor: contact.decisor,
          });
          imported++;
        } catch (error) {
          errors.push({
            row: contact.row,
            reason:
              error instanceof Error
                ? error.message
                : 'Erro desconhecido ao criar contato.',
          });
        }
      }
    }

    return { total, imported, errors };
  }

  async findAll(
    tx: TenantTx,
    membership: MembershipContext,
    query: ListRawLeadsQueryDto,
  ): Promise<PaginatedResult<RawLead>> {
    if (!this.policy.canModule(membership, 'leads', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver leads.');
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const status = query.status ?? 'novo';

    // Filtro por tier considera a classificação manual como override: um
    // lead com manualTier='quente' aparece no filtro "quente" mesmo que o
    // score não bata na faixa, e o inverso também (manualTier='frio" some
    // do filtro "quente" mesmo com score alto). Sem manualTier, cai no
    // cálculo automático de sempre (faixa de score). `AND` (em vez de um
    // segundo `OR` no mesmo objeto) porque o filtro de busca `q` já usa a
    // chave `OR` — duas chaves `OR` no mesmo objeto colidiriam.
    // Carteira por representante (pedido direto do usuário, 2026-08-06):
    // owner/admin veem tudo, manager vê o próprio + subordinados, sales_rep
    // só o que ele mesmo importou/cadastrou — mesmo PolicyService já usado
    // por Company/Opportunity/Task (Fatia 9), reverte a decisão anterior de
    // raw_leads ser "área comum".
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    const scoreRange = this.tierRange(query.tier);
    const where: Prisma.RawLeadWhereInput = {
      workspaceId: membership.workspaceId,
      ...ownerFilter,
      status,
      AND: [
        ...(query.tier
          ? [
              {
                OR: [
                  { manualTier: query.tier },
                  { manualTier: null, score: scoreRange },
                ],
              } satisfies Prisma.RawLeadWhereInput,
            ]
          : []),
        ...(query.q
          ? [
              {
                OR: [
                  { razaoSocial: { contains: query.q, mode: 'insensitive' } },
                  { cnaePrincipal: { contains: query.q, mode: 'insensitive' } },
                  { cnaeDescricao: { contains: query.q, mode: 'insensitive' } },
                ],
              } satisfies Prisma.RawLeadWhereInput,
            ]
          : []),
      ],
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
    return this.mustBeVisible(tx, membership, id);
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
    const lead = await this.mustBeNovo(tx, membership, id);
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

    const updated = await tx.company.update({
      where: { id: company.id },
      data: { tags: company.tags.filter((t) => t !== 'lead-triagem') },
    });

    // Feed "Últimas atividades" do Painel comercial (fora do
    // SPEC-CRM-GAMA.md original) precisa distinguir "prospecção que virou
    // lead" de um cadastro de empresa comum — sem isto, a aprovação era
    // invisível pra fora da tela de Leads (só mudava a tag, sem registro).
    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'lead_approved', razaoSocial: lead.razaoSocial },
      companyId: updated.id,
    });

    return updated;
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
    const lead = await this.mustBeNovo(tx, membership, id);
    return tx.rawLead.update({
      where: { id: lead.id },
      data: { status: 'descartado' },
    });
  }

  // Classificação manual (Quente/Morno/Frio) — pedido direto do usuário,
  // fora do §4.4 original. `tier: null` limpa a marcação e volta a usar o
  // score automático (ver comentário em findAll sobre como o filtro
  // considera as duas coisas juntas).
  async setManualTier(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateLeadTierDto,
  ): Promise<RawLead> {
    await this.mustBeVisible(tx, membership, id, 'write');
    return tx.rawLead.update({
      where: { id },
      data: { manualTier: dto.tier },
    });
  }

  // Tags livres de organização (pedido direto do usuário, 2026-08-05, fora
  // do §4.4 original) — substitui o conjunto inteiro (mesmo contrato de
  // setManualTier acima: o cliente sempre manda o array completo
  // desejado). Normaliza aqui (trim, remove vazio/duplicata
  // case-insensitive) em vez de no DTO — decorators só validam forma, não
  // reescrevem o valor.
  async setTags(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateLeadTagsDto,
  ): Promise<RawLead> {
    await this.mustBeVisible(tx, membership, id, 'write');
    return tx.rawLead.update({
      where: { id },
      data: { tags: this.normalizeTags(dto.tags) },
    });
  }

  // Segmento de negócio (pedido direto do usuário, 2026-08-05, mesmo dia
  // de setTags acima) — diferente de tags: valor único, não array. Trim
  // aqui (não no DTO); string vazia depois do trim vira null, mesmo
  // resultado de mandar `segmento: null` explicitamente.
  async setSegmento(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateLeadSegmentoDto,
  ): Promise<RawLead> {
    await this.mustBeVisible(tx, membership, id, 'write');
    const trimmed = dto.segmento?.trim();
    return tx.rawLead.update({
      where: { id },
      data: { segmento: trimmed ? trimmed : null },
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
  // Mesmo escopo por carteira de findAll (2026-08-06): sem o filtro
  // explícito aqui, um manager recalcularia o workspace inteiro (a RLS
  // libera isso pro papel manager por completo, não só pra hierarquia
  // dele — só o PolicyService sabe filtrar por subordinados).
  async rescoreAll(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<{ updated: number }> {
    const ownerFilter = await this.policy.scopeFilter(tx, membership);
    const leads = await tx.rawLead.findMany({
      where: {
        workspaceId: membership.workspaceId,
        ...ownerFilter,
        status: 'novo',
      },
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

  // Escopo igual ao da query retroativa (scripts/uppercase-cadastros-
  // prospeccao.sql): razão social e os campos "de identidade/endereço"
  // texto livre — fora arrays (tags/socios/emails/fones) e identificadores
  // técnicos (cnpj, email fica minúsculo por convenção). `razaoSocial` é
  // sempre string aqui (obrigatório no DTO); os demais são opcionais.
  private upperCaseTextFields(dto: CreateRawLeadDto): CreateRawLeadDto {
    const up = (value?: string) => value?.toUpperCase();
    return {
      ...dto,
      razaoSocial: dto.razaoSocial.toUpperCase(),
      fantasia: up(dto.fantasia),
      cnaePrincipal: up(dto.cnaePrincipal),
      cnaeDescricao: up(dto.cnaeDescricao),
      porte: up(dto.porte),
      uf: up(dto.uf),
      municipio: up(dto.municipio),
      situacao: up(dto.situacao),
    };
  }

  private normalizeTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
      const t = raw.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  private tierRange(
    tier: 'quente' | 'morno' | 'frio' | undefined,
  ): Prisma.IntFilter | undefined {
    if (tier === 'quente') return { gte: 70 };
    if (tier === 'morno') return { gte: 45, lt: 70 };
    if (tier === 'frio') return { lt: 45 };
    return undefined;
  }

  // 404 (não 403) quando a policy nega — não confirma pra quem não tem
  // acesso que o registro existe no workspace, mesmo critério de
  // CompanyService#mustBeVisible/OpportunityService#mustBeVisible.
  private async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    action: 'read' | 'write' = 'read',
  ): Promise<RawLead> {
    const lead = await tx.rawLead.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!lead) {
      throw new NotFoundException('Lead não encontrado.');
    }
    if (!(await this.policy.can(tx, membership, action, lead, 'leads'))) {
      throw new NotFoundException('Lead não encontrado.');
    }
    return lead;
  }

  private async mustBeNovo(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<RawLead> {
    const lead = await this.mustBeVisible(tx, membership, id, 'write');
    if (lead.status !== 'novo') {
      throw new BadRequestException('Lead já foi aprovado ou descartado.');
    }
    return lead;
  }
}
