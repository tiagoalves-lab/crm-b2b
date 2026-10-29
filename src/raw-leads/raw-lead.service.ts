import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Company, type RawLead } from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import { ultimoContatoPorEmpresa } from '../activities/ultimo-contato';
import type {
  PaginatedResult,
  SemTimeline,
} from '../companies/company.service';
import { CLIENTE_WHERE } from '../companies/cliente-regra';
import { CompanyService } from '../companies/company.service';
import { ContactService } from '../companies/contact.service';
import type { CreateCompanyDto } from '../companies/dto/create-company.dto';
import { resolveRazaoSocial } from '../common/sanitize-razao-social';
import { SupabaseUserService } from '../memberships/supabase-user.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { parseContactsSpreadsheet } from './contacts-spreadsheet-import.util';
import type { CreateRawLeadDto } from './dto/create-raw-lead.dto';
import type { ListRawLeadsQueryDto } from './dto/list-raw-leads-query.dto';
import type { UpdateLeadCadastroDto } from './dto/update-lead-cadastro.dto';
import type { UpdateLeadEtapaDto } from './dto/update-lead-etapa.dto';
import type { UpdateLeadSegmentoDto } from './dto/update-lead-segmento.dto';
import type { UpdateLeadTagsDto } from './dto/update-lead-tags.dto';
import type { UpdateLeadTierDto } from './dto/update-lead-tier.dto';
import { etapaAvancada, marcaPassagem } from './etapa-funil';
import { LeadScoringService } from './lead-scoring.service';
import {
  indexarRepresentantes,
  resolverRepresentante,
  type IndiceRepresentantes,
} from './representante-planilha';
import {
  parseLeadsSpreadsheet,
  type RowError,
} from './spreadsheet-import.util';

export interface BulkResult {
  ok: string[];
  failed: Array<{ id: string; reason: string }>;
}

// Dono do lead quando NÃO é quem está autenticado (coluna "Representante"
// da planilha, 2026-09-23). Fica em `options`, e não no
// CreateRawLeadDto, de propósito: o DTO é o corpo do POST /raw-leads, e
// deixar o cliente escolher o dono por HTTP abriria a carteira de
// qualquer representante pra quem souber o id. Quem preenche isto é o
// importador, depois de checar alçada (ver representante-planilha.ts).
export interface CriarLeadOptions extends SemTimeline {
  ownerUserId?: string;
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
    private readonly supabaseUsers: SupabaseUserService,
  ) {}

  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dtoRaw: CreateRawLeadDto,
    // Carga em massa (planilha) e entrada automática (Meta) não escrevem
    // "cadastro criado" na Timeline — ver SemTimeline em
    // companies/company.service.ts. Cadastro manual pela Prospecção
    // continua registrando.
    options: CriarLeadOptions = {},
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
      // Representante indicado na planilha (2026-09-23) — é o que faz o
      // supervisor DELE (e não o de quem importou) entrar na equipe de
      // vendas da empresa, via herdarSupervisor em CompanyService#create.
      ownerUserId: options.ownerUserId,
    };
    const company = await this.companies.create(
      tx,
      membership,
      companyDto,
      options,
    );

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
        // — quem está autenticado, ou o representante indicado na coluna
        // da planilha (2026-09-23, alçada checada antes de chegar aqui;
        // nunca escolhido pelo cliente via HTTP). Mesmo valor de
        // `company.ownerUserId` acima (a company nasce junto com o lead,
        // ver comentário na classe), mas é o ownerUserId do RawLead que
        // this.findAll/mustBeVisible checam pra Prospecção.
        ownerUserId: options.ownerUserId ?? membership.userId,
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
        await this.create(tx, membership, dto, { semTimeline: true });
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

  // Preparo da coluna "Representante" (2026-09-23), em duas etapas de
  // propósito: esta primeira é uma transação CURTA, só pra saber quem são
  // os membros ativos do workspace…
  async listarMembrosAtivos(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<string[]> {
    const membros = await tx.membership.findMany({
      where: { workspaceId: membership.workspaceId, status: 'active' },
      select: { userId: true },
    });
    return membros.map((m) => m.userId);
  }

  // …e esta segunda é só rede (Admin API do Supabase, onde vivem nome/
  // login/e-mail) — nunca deve rodar dentro de uma transação do Postgres,
  // mesmo motivo documentado em EgestorUsuarioService. Falha na Admin API
  // devolve índice vazio: nenhuma linha com representante preenchido é
  // importada às cegas, cada uma vira erro de linha ("não encontrado").
  async indexarRepresentantes(
    userIds: string[],
  ): Promise<IndiceRepresentantes> {
    const identidades = await this.supabaseUsers.getIdentities(userIds);
    return indexarRepresentantes(identidades);
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
    // Índice nome/login/e-mail → membro da coluna "Representante"
    // (2026-09-23), montado FORA desta transação pelo controller —
    // resolvê-lo aqui dentro significaria uma chamada HTTP ao Supabase
    // Auth segurando uma conexão do pool (mesmo cuidado já documentado em
    // EgestorUsuarioService). Ausente = nenhuma linha distribui, todo lead
    // fica com quem importou.
    representantes: IndiceRepresentantes = {
      porChave: new Map(),
      ambiguas: new Set(),
    },
  ): Promise<ImportResult> {
    const { groups, errors } = await parseContactsSpreadsheet(
      file.buffer,
      file.originalname,
    );
    const total =
      groups.reduce((acc, g) => acc + g.contacts.length, 0) + errors.length;

    let imported = 0;
    for (const group of groups) {
      // Coluna "Representante": erro de linha (não derruba a planilha
      // inteira) quando o nome não casa com ninguém da equipe ou quando
      // quem importa não tem alçada pra distribuir.
      const dono = resolverRepresentante(group.representante, representantes, {
        userId: membership.userId,
        role: membership.role,
      });
      if (!dono.ok) {
        errors.push({
          row: group.firstRow,
          reason: `${dono.motivo} Os ${group.contacts.length} contato(s) desta empresa não foram importados.`,
        });
        continue;
      }

      const companyDto: CreateRawLeadDto = {
        razaoSocial: group.razaoSocial,
        cnpj: group.cnpj,
        cnaePrincipal: group.cnaePrincipal,
        porte: group.porte,
        uf: group.uf,
        municipio: group.municipio,
        situacao: group.situacao,
        fantasia: group.fantasia,
        tags: group.tags,
        dtAbertura: group.dtAbertura,
      };

      let lead: RawLead;
      try {
        lead = await this.create(tx, membership, companyDto, {
          semTimeline: true,
          ownerUserId: dono.userId,
        });
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

          await this.contacts.create(
            tx,
            membership,
            lead.promotedCompanyId!,
            {
              nome: contact.nome,
              cargo: contact.cargo,
              email: contact.email,
              telefone: contact.telefone,
              decisor: contact.decisor,
            },
            // Contato fica com o mesmo representante do lead — senão o
            // gerente importa a carteira do outro e leva os contatos
            // junto (a RLS de contacts filtra por dono).
            dono.userId,
          );
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
  ): Promise<PaginatedResult<RawLead & { ultimoContato: string | null }>> {
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
    // rawLeadReadFilter (não scopeFilter puro) desde 2026-09-21: soma a
    // carteira própria à equipe de vendas da empresa do lead — ver
    // PolicyService.rawLeadReadFilter.
    const ownerFilter = await this.policy.rawLeadReadFilter(tx, membership);
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

    // Coluna "Último contato" — a Timeline do lead é a da empresa criada
    // junto com ele (promotedCompanyId).
    const ultimoContato = await ultimoContatoPorEmpresa(
      tx,
      membership.workspaceId,
      items
        .map((l) => l.promotedCompanyId)
        .filter((id): id is string => id !== null),
    );

    return {
      items: items.map((l) => ({
        ...l,
        ultimoContato: l.promotedCompanyId
          ? (ultimoContato.get(l.promotedCompanyId) ?? null)
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  // Badge do menu "Leads convertidos" (2026-10-27): empresas de lead
  // convertido que ainda não compraram — mesmo recorte da tela
  // (web/app/dashboard/leads-convertidos): carteira do lead, empresa
  // visível, não excluída, fora da triagem e sem compra (CLIENTE_WHERE).
  // Conta EMPRESA, não lead: dois leads da mesma empresa são uma linha só.
  async contarConvertidosSemCompra(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<number> {
    if (!this.policy.canModule(membership, 'leads', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver leads.');
    }
    const [ownerFilter, companyFilter] = await Promise.all([
      this.policy.rawLeadReadFilter(tx, membership),
      this.policy.companyReadFilter(tx, membership),
    ]);
    const empresas = await tx.rawLead.findMany({
      where: {
        workspaceId: membership.workspaceId,
        ...ownerFilter,
        status: 'aprovado',
        promotedCompany: {
          is: {
            workspaceId: membership.workspaceId,
            deletedAt: null,
            AND: [
              companyFilter,
              { NOT: { tags: { has: 'lead-triagem' } } },
              { NOT: CLIENTE_WHERE },
            ],
          },
        },
      },
      select: { promotedCompanyId: true },
      distinct: ['promotedCompanyId'],
    });
    return empresas.length;
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
    // CNPJ obrigatório pra virar empresa (decisão do usuário, 2026-09-04):
    // o lead do formulário do Meta chega sem CNPJ e pode ficar assim na
    // triagem, mas é a chave que une tudo no CRM (regras de negócio, 5.3) —
    // preencher na ficha (updateCadastro) antes de aprovar. Conferido em
    // produção antes de ligar: nenhum lead existente sem CNPJ.
    if (!lead.cnpj?.trim()) {
      throw new BadRequestException(
        'Preencha o CNPJ do lead antes de aprovar — é a chave que une a empresa no CRM.',
      );
    }
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
      // convertedAt (2026-09-21): a data da passagem, pro funil do Painel
      // medir movimento por período em vez de estoque acumulado. Só na
      // primeira conversão — reconversão não reescreve a série.
      // etapa (2026-09-23): converter é a passagem pra última faixa do
      // funil de prospecção — dali pra frente quem acompanha é o Pipeline.
      data: {
        status: 'aprovado',
        etapa: 'negociacao',
        convertedAt: lead.convertedAt ?? new Date(),
      },
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
      payload: {
        action: 'lead_approved',
        origem: 'prospeccao',
        razaoSocial: lead.razaoSocial,
      },
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
      // discardedAt: mesma razão de convertedAt em approve() — é a saída
      // do funil, e o funil por período precisa saber quando foi.
      data: {
        status: 'descartado',
        discardedAt: lead.discardedAt ?? new Date(),
      },
    });
  }

  // Recuperar lead descartado (pedido do usuário, 2026-10-19) — desfaz
  // discard(): o lead volta pra triagem na etapa em que parou (a etapa
  // nunca foi apagada). A company-lead nunca saiu do lugar, então não há
  // nada a restaurar nela. discardedAt volta a null: o lead está no funil
  // de novo, e um descarte futuro é uma saída nova, com a data dela.
  //
  // Duas travas, porque enquanto o lead esteve descartado a empresa pode
  // ter seguido outro caminho:
  // - outro lead em triagem pro mesmo CNPJ/empresa (create() não olha os
  //   descartados no dedupe) — recuperar duplicaria o cartão no quadro;
  // - a empresa já não é lead-triagem (foi convertida por outro lead, ou
  //   o lead caiu numa empresa que já estava na Carteira) — devolver à
  //   triagem algo que já saiu dela bagunçaria a carteira.
  async restore(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<RawLead> {
    const lead = await this.mustBeVisible(tx, membership, id, 'write');
    if (lead.status !== 'descartado') {
      throw new BadRequestException('Só lead descartado pode ser recuperado.');
    }

    // Lead sem CNPJ e sem empresa deixa o OR vazio — o Prisma trata como
    // "nenhum", então não há com quem conflitar.
    const outroEmTriagem = await tx.rawLead.findFirst({
      where: {
        workspaceId: membership.workspaceId,
        id: { not: lead.id },
        status: 'novo',
        OR: [
          ...(lead.cnpj ? [{ cnpj: lead.cnpj }] : []),
          ...(lead.promotedCompanyId
            ? [{ promotedCompanyId: lead.promotedCompanyId }]
            : []),
        ],
      },
      select: { id: true },
    });
    if (outroEmTriagem) {
      throw new BadRequestException(
        'Esta empresa já tem outro lead em andamento na Prospecção — trabalhe por ele.',
      );
    }

    if (lead.promotedCompanyId) {
      const company = await tx.company.findFirst({
        where: {
          id: lead.promotedCompanyId,
          workspaceId: membership.workspaceId,
        },
        select: { tags: true, deletedAt: true },
      });
      if (
        company &&
        !company.deletedAt &&
        !company.tags.includes('lead-triagem')
      ) {
        throw new BadRequestException(
          'Esta empresa já foi convertida ou já é cliente — trabalhe pela ficha dela.',
        );
      }
    }

    return tx.rawLead.update({
      where: { id: lead.id },
      data: { status: 'novo', discardedAt: null },
    });
  }

  // Desconverter lead (pedido do usuário, 2026-10-27) — desfaz approve():
  // o lead volta pra triagem e a empresa volta a ser company-lead (tag
  // lead-triagem), saindo de Leads convertidos.
  //
  // Trava principal, pedida pelo usuário: empresa com proposta vinculada
  // (qualquer oportunidade não excluída, inclusive da carga histórica)
  // mantém a conversão — a proposta só existe porque o lead foi
  // convertido, e devolvê-lo à triagem deixaria o Pipeline apontando pra
  // um prospect. Empresa que já comprou também não volta (é cliente,
  // decisão 6.23), e outro lead convertido na mesma empresa impede, porque
  // a tag da empresa é uma só pros dois.
  //
  // Volta pra etapa mais adiantada que o lead já tinha alcançado (as datas
  // de passagem dizem qual), porque approve() sobrescreveu a etapa com
  // Negociação. convertedAt volta a null: a conversão não se sustentou, e
  // uma nova conversão é uma passagem nova, com a data dela.
  async unconvert(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<RawLead> {
    const lead = await this.mustBeVisible(tx, membership, id, 'write');
    if (lead.status !== 'aprovado') {
      throw new BadRequestException('Só lead convertido pode ser desconvertido.');
    }
    if (!lead.promotedCompanyId) {
      throw new BadRequestException('Lead sem empresa associada.');
    }
    const companyId = lead.promotedCompanyId;

    const [company, propostas, compras, outroConvertido] = await Promise.all([
      tx.company.findFirst({
        where: { id: companyId, workspaceId: membership.workspaceId },
        select: { id: true, tags: true },
      }),
      tx.opportunity.count({
        where: { workspaceId: membership.workspaceId, companyId, deletedAt: null },
      }),
      tx.salesHistory.count({
        where: { workspaceId: membership.workspaceId, companyId },
      }),
      tx.rawLead.findFirst({
        where: {
          workspaceId: membership.workspaceId,
          id: { not: lead.id },
          status: 'aprovado',
          promotedCompanyId: companyId,
        },
        select: { id: true },
      }),
    ]);
    if (!company) {
      throw new NotFoundException('Empresa do lead não encontrada.');
    }
    if (propostas > 0) {
      throw new BadRequestException(
        `Esta empresa tem ${propostas} proposta(s) vinculada(s) no Pipeline — a conversão fica mantida.`,
      );
    }
    if (compras > 0) {
      throw new BadRequestException(
        'Esta empresa já comprou (pedido no eGestor) — é cliente, a conversão fica mantida.',
      );
    }
    if (outroConvertido) {
      throw new BadRequestException(
        'Esta empresa tem outro lead convertido — a conversão fica mantida.',
      );
    }

    const etapa = lead.qualifiedAt
      ? 'qualificado'
      : lead.reuniaoAt
        ? 'reuniao'
        : lead.andamentoAt
          ? 'andamento'
          : 'entrada';

    const updated = await tx.rawLead.update({
      where: { id: lead.id },
      data: { status: 'novo', etapa, convertedAt: null },
    });
    if (!company.tags.includes('lead-triagem')) {
      await tx.company.update({
        where: { id: company.id },
        data: { tags: [...company.tags, 'lead-triagem'] },
      });
    }

    await this.activities.emit(tx, {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      type: 'field_update',
      payload: { action: 'lead_unconverted', razaoSocial: lead.razaoSocial },
      companyId: company.id,
    });

    return updated;
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
    const atual = await this.mustBeVisible(tx, membership, id, 'write');
    // Informar o prazo É a qualificação (decisão 6.2), então o cartão
    // sobe sozinho pra etapa Qualificado no quadro — sem isso o SDR
    // classificaria e depois arrastaria, dando a mesma informação
    // duas vezes. Limpar o prazo devolve o cartão pra Andamento (sem
    // prazo não houve qualificação) e nunca mexe em quem já está em
    // Negociação/Fechamento.
    const etapa =
      dto.tier === null
        ? atual.etapa === 'qualificado'
          ? 'andamento'
          : atual.etapa
        : etapaAvancada(atual.etapa, 'qualificado');
    return tx.rawLead.update({
      where: { id },
      // qualifiedAt (2026-09-21): a qualificação do SDR é o prazo de
      // investimento, então a data da qualificação é a data em que o
      // prazo entrou. Guarda a PRIMEIRA (trocar Curto por Médio não
      // requalifica); limpar a classificação limpa a data, porque sem
      // prazo não houve qualificação.
      data: {
        manualTier: dto.tier,
        qualifiedAt:
          dto.tier === null ? null : (atual.qualifiedAt ?? new Date()),
        etapa,
        ...marcaPassagem(etapa, atual),
      },
    });
  }

  // Mover o cartão de etapa no quadro da Prospecção (2026-09-23) — é onde
  // o arrasto do Kanban cai. Diferente do avanço automático (que só
  // empurra pra frente, ver etapa-funil.ts), aqui quem manda é a pessoa:
  // dá pra puxar o cartão de volta pra Andamento quando a reunião não
  // aconteceu.
  //
  // Lead fora da triagem não se move à mão: quem está em
  // Negociação/Fechamento chegou lá por ter sido convertido (a etapa é
  // consequência do status), e descartado nem aparece no quadro.
  async setEtapa(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateLeadEtapaDto,
  ): Promise<RawLead> {
    const atual = await this.mustBeVisible(tx, membership, id, 'write');
    if (atual.status !== 'novo') {
      throw new BadRequestException(
        'Só lead em triagem muda de etapa — este já saiu do funil de prospecção.',
      );
    }
    if (dto.etapa === 'negociacao') {
      throw new BadRequestException(
        'Negociação/Fechamento é consequência de converter o lead — use "Converter lead".',
      );
    }
    return tx.rawLead.update({
      where: { id },
      // A data de qualificação acompanha a etapa: arrastar o cartão pra
      // Qualificado sem prazo informado não inventa prazo, mas marca a
      // passagem — que é o que o funil do Painel mede por período.
      data: {
        etapa: dto.etapa,
        ...marcaPassagem(dto.etapa, atual),
        ...(dto.etapa === 'qualificado' && !atual.qualifiedAt
          ? { qualifiedAt: new Date() }
          : {}),
      },
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

  // Completar/corrigir o cadastro de um lead em triagem (pedido do usuário,
  // 2026-09-04): o lead do formulário do Meta chega sem CNPJ, e é aqui que
  // o vendedor preenche — o frontend consulta a Receita e manda CNPJ +
  // razão social + CNAE + porte + situação + cidade/UF de uma vez. Recalcula
  // o score (os campos que entram na fórmula podem ter mudado) e espelha na
  // company-lead o que ela também guarda (razão social, CNPJ, cidade/UF),
  // pra "Aprovar para Lead" já encontrar a empresa completa.
  //
  // CNPJ é a chave que une tudo (regras de negócio, 5.3) — por isso dois
  // bloqueios antes de gravar: outro lead em triagem com o mesmo CNPJ (seria
  // a duplicata que create() já evita na importação) e empresa já
  // cadastrada com esse CNPJ fora da triagem deste lead (cliente real, em
  // geral vindo do eGestor — o certo é trabalhar pela ficha dela, não
  // duplicar pela Prospecção).
  async updateCadastro(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dtoRaw: UpdateLeadCadastroDto,
  ): Promise<RawLead> {
    // Lead descartado (2026-10-07): ainda pode reconsultar a Receita pelo
    // mesmo CNPJ (botão "Buscar dados na Receita" da ficha), mas não troca
    // o CNPJ. Lead aprovado troca (2026-10-26: CNPJ errado num aprovado não
    // tinha como ser corrigido pela Prospecção — a ficha da empresa já
    // deixava, e o espelho abaixo leva a troca pra company-lead).
    const lead = await this.mustBeVisible(tx, membership, id, 'write');
    if (
      lead.status === 'descartado' &&
      dtoRaw.cnpj !== undefined &&
      (dtoRaw.cnpj ?? '').replace(/\D/g, '') !== (lead.cnpj ?? '').replace(/\D/g, '')
    ) {
      throw new BadRequestException(
        'Lead descartado — o CNPJ não pode mais ser trocado.',
      );
    }
    const dto = this.upperCaseCadastroFields(dtoRaw);

    // undefined = não tocar; null = limpar; string = dígitos validados.
    let cnpj: string | null | undefined;
    if (dto.cnpj === null) {
      cnpj = null;
    } else if (dto.cnpj !== undefined) {
      const digits = dto.cnpj.replace(/\D/g, '');
      if (digits.length !== 14) {
        throw new BadRequestException('CNPJ precisa ter 14 dígitos.');
      }
      cnpj = digits;

      const outroLead = await tx.rawLead.findFirst({
        where: {
          workspaceId: membership.workspaceId,
          cnpj: digits,
          status: 'novo',
          id: { not: lead.id },
        },
        select: { id: true },
      });
      if (outroLead) {
        throw new BadRequestException(
          'Já existe outro lead na Prospecção com este CNPJ.',
        );
      }

      // Mesma function SECURITY DEFINER de CompanyService#create — a RLS
      // esconderia a empresa de outro representante e a checagem daria
      // falso negativo (ver comentário na migration 20260806190000).
      const rows = await tx.$queryRaw<Array<{ id: string | null }>>(
        Prisma.sql`SELECT public.find_company_id_by_cnpj(${membership.workspaceId}::uuid, ${digits}) AS id`,
      );
      const existingCompanyId = rows[0]?.id;
      if (existingCompanyId && existingCompanyId !== lead.promotedCompanyId) {
        throw new BadRequestException(
          lead.status === 'novo'
            ? 'Este CNPJ já está cadastrado em Empresas. Descarte este lead e trabalhe pela ficha da empresa existente.'
            : 'Este CNPJ já está cadastrado em outra empresa do CRM.',
        );
      }
    }

    const razao =
      dto.razaoSocial !== undefined
        ? resolveRazaoSocial(dto.razaoSocial, dto.emRecuperacaoJudicial)
        : undefined;

    const data: Prisma.RawLeadUpdateInput = {
      ...(cnpj !== undefined ? { cnpj } : {}),
      ...(razao
        ? {
            razaoSocial: razao.razaoSocial,
            emRecuperacaoJudicial: razao.emRecuperacaoJudicial,
          }
        : {}),
      ...(dto.cnaePrincipal !== undefined
        ? { cnaePrincipal: dto.cnaePrincipal }
        : {}),
      ...(dto.cnaeDescricao !== undefined
        ? { cnaeDescricao: dto.cnaeDescricao }
        : {}),
      ...(dto.porte !== undefined ? { porte: dto.porte } : {}),
      ...(dto.uf !== undefined ? { uf: dto.uf } : {}),
      ...(dto.municipio !== undefined ? { municipio: dto.municipio } : {}),
      ...(dto.situacao !== undefined ? { situacao: dto.situacao } : {}),
    };

    const { score } = this.scoring.score({
      cnaePrincipal: dto.cnaePrincipal ?? lead.cnaePrincipal,
      importador: lead.importador,
      porte: dto.porte ?? lead.porte,
      situacao: dto.situacao ?? lead.situacao,
      uf: dto.uf ?? lead.uf,
    });

    const updated = await tx.rawLead.update({
      where: { id: lead.id },
      data: { ...data, score },
    });

    if (lead.promotedCompanyId) {
      // updateMany (não update): se a RLS esconder a company-lead deste
      // usuário, 0 linhas em vez de estourar a transação inteira — o lead em
      // si já foi atualizado, que é o que a Prospecção mostra.
      await tx.company.updateMany({
        where: {
          id: lead.promotedCompanyId,
          workspaceId: membership.workspaceId,
        },
        data: {
          ...(cnpj !== undefined ? { cpfCnpj: cnpj } : {}),
          ...(razao
            ? {
                razaoSocial: razao.razaoSocial,
                emRecuperacaoJudicial: razao.emRecuperacaoJudicial,
              }
            : {}),
          ...(dto.uf !== undefined ? { uf: dto.uf } : {}),
          ...(dto.municipio !== undefined ? { cidade: dto.municipio } : {}),
        },
      });
    }

    return updated;
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

  // Mesmo escopo de upperCaseTextFields, pros campos que chegam no
  // updateCadastro (todos opcionais — `undefined` continua `undefined`).
  private upperCaseCadastroFields(
    dto: UpdateLeadCadastroDto,
  ): UpdateLeadCadastroDto {
    const up = (value?: string) => value?.toUpperCase();
    return {
      ...dto,
      razaoSocial: up(dto.razaoSocial),
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
    // canReachRawLead (não can() puro) desde 2026-09-21: quem está na
    // equipe de vendas da empresa abre e trabalha o lead dela, mesmo sem
    // ser o dono nem subordinado — ver PolicyService.rawLeadReadFilter.
    if (!(await this.policy.canReachRawLead(tx, membership, action, lead))) {
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
