import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Company, type OpportunityStatus } from '@prisma/client';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { montarAtualizacaoCartaoCnpj } from '../../companies/cartao-cnpj';
import { CompanyService } from '../../companies/company.service';
import { SupabaseUserService } from '../../memberships/supabase-user.service';
import { ETAPA_LABEL } from '../../raw-leads/etapa-funil';
import {
  garantirLeadConvertido,
  registrarConversao,
} from '../../raw-leads/lead-convertido-automatico';
import { HtmlPdfService } from '../../pdf/html-pdf.service';
import { OpportunityItemService } from '../../opportunities/opportunity-item.service';
import { OpportunityService } from '../../opportunities/opportunity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseStorageService } from '../../storage/supabase-storage.service';
import {
  TenantContextService,
  type TenantTx,
} from '../../tenancy/tenant-context.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import { OptimisticConcurrencyException } from '../../common/exceptions/optimistic-concurrency.exception';
import {
  AvancarEstagioDto,
  type EtapaCotacoes,
} from './dto/avancar-estagio.dto';
import { BuscarCompaniesQueryDto } from './dto/buscar-companies-query.dto';
import { FilaQueryDto } from './dto/fila-query.dto';
import { ItensValorDto } from './dto/itens-valor.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { TrelloComentarioDto } from './dto/trello-comentario.dto';
import { TrelloComentariosDto } from './dto/trello-comentarios.dto';
import {
  TRELLO_STATUS_MAX_IDS,
  TrelloStatusQueryDto,
} from './dto/trello-status-query.dto';
import { TrelloVinculoDto } from './dto/trello-vinculo.dto';
import { UpsertClienteDto } from './dto/upsert-cliente.dto';
import { UpsertPropostaDto } from './dto/upsert-proposta.dto';

// Mesmos sentinelas do webhook do Meta (meta-leads-webhook.service.ts):
// integração é sempre do workspace da Gama, e o ator é o usuário-sistema.
const DEFAULT_WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

const PAGE_SIZE_PADRAO = 200;

// Resultado do Cartão CNPJ no cadastro vindo do app de cotações — vai na
// resposta pro app avisar quando a Receita não respondeu.
export type StatusReceitaCotacoes =
  'preenchido' | 'ja_tinha' | 'sem_cnpj' | 'erro';

// Busca ao vivo do app de cotações: o usuário escolhe uma empresa numa
// lista curta, não pagina resultado. Mínimos existem pra uma tecla solta
// não varrer a base inteira; o CNPJ aceita menos porque 4 dígitos já
// separam bem (e é assim que se digita um CNPJ pela metade).
const BUSCA_LIMITE_PADRAO = 20;
const BUSCA_TERMO_MIN = 3;
const BUSCA_CNPJ_MIN = 4;
const CNPJ_DIGITOS = 14;

// Folga da marca d'água devolvida ao app de cotações: uma company alterada
// enquanto a varredura paginada roda pode ter updated_at menor que o fim da
// varredura sem ter entrado em nenhuma página. Recuar 5 min faz a varredura
// seguinte repescar esse intervalo — o upsert do espelho é idempotente,
// reprocessar de novo não custa nada.
const MARCA_DAGUA_FOLGA_MS = 5 * 60 * 1000;

// Estágio em que a oportunidade nasce quando vem de um cartão do Trello:
// a solicitação chegou, ninguém cotou ainda. Resolvido por NOME (não por
// UUID cravado, que é criado pelo seed e não tem chave estável) — se
// alguém renomear o estágio, cai no primeiro do funil em vez de quebrar.
const ESTAGIO_INICIAL_NOME = 'Solicitação de Propostas';

// Etapa pedida pelo app de cotações → nome do estágio no funil (rota
// `estagio`, 2026-10-08). Mesmo critério do inicial: por nome.
const ESTAGIO_POR_ETAPA: Record<EtapaCotacoes, string> = {
  aprovacao: 'Aprovação de Propostas',
  aprovadas: 'Propostas aprovadas',
};

// Etapa que só move card que está num estágio específico (2026-10-28). O PDF
// entregue leva o card de Aprovação de Propostas para Propostas aprovadas — e
// só de lá: card ainda em Solicitação/Elaboração tem outra máquina em cotação
// (o app só o leva a Aprovação quando todas chegam lá), então pular para
// "aprovadas" esconderia essa pendência.
const ORIGEM_EXIGIDA: Partial<Record<EtapaCotacoes, string>> = {
  aprovadas: 'Aprovação de Propostas',
};

// Uma oportunidade vinda do Trello nasce sem valor: o preço só existe
// depois que alguém cota. `amount` é NOT NULL, então nasce zerada.
const VALOR_INICIAL = 0;
const MOEDA_PADRAO = 'BRL';

// Transação do cadastro: cria a oportunidade, a lista de itens e espelha
// o chat do cartão numa tacada. O default de 5s do Prisma é curto pra
// tantas idas ao banco em sequência (mesmo motivo do import de planilha).
const VINCULO_TIMEOUT_MS = 15_000;

// Tamanho mínimo do primeiro nome pra casar representante com quadro do
// Trello. Nome curto demais casaria com qualquer palavra do quadro.
const NOME_MIN_PARA_CASAR = 4;

// O que a tela do Trello precisa saber de cada cartão pra decidir entre
// "Cadastrar Oportunidade" e "Ver Oportunidade".
export interface TrelloStatusItem {
  card_id: string;
  opportunity_id: string;
  empresa: string | null;
  estagio: string | null;
  status: OpportunityStatus;
  itens: number;
  // Os itens do card, na ordem do card (2026-10-07): a coluna Itens da tela
  // do Trello mostra o que está no CRM, não o checklist do cartão — depois
  // de cadastrada, a lista é editada no card e o checklist fica velho.
  itens_lista: { id: string; nome: string }[];
  comentarios: number;
  sincronizado_em: string | null;
}

export interface CompanyParaCotacoes {
  id: string;
  cnpj: string;
  razao_social: string | null;
  fantasia: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  indicador_ie: string | null;
  inscricao_estadual: string | null;
  atualizado_em: string;
}

// Empresa ainda na triagem da Prospecção, achada pelo CNPJ exato na busca
// ao vivo. `etapa` é o nome da coluna do funil, já pronto pra mostrar.
export interface ProspectParaCotacoes extends CompanyParaCotacoes {
  etapa: string | null;
  descartado: boolean;
}

@Injectable()
export class CotacoesService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    // A oportunidade é criada pelo serviço de verdade, não por um insert
    // paralelo: é ele que valida owner/estágio e emite a Activity de
    // criação. Integração que reimplementa regra de negócio vira uma
    // segunda verdade que ninguém lembra de atualizar.
    private readonly opportunities: OpportunityService,
    // Nome/login do membro vivem em auth.users (Supabase Auth), não numa
    // tabela nossa — é por aqui que se casa o quadro do Trello com o
    // representante. Mesmo uso que o módulo do eGestor faz pra casar
    // vendedor do ERP com membro do CRM.
    private readonly supabaseUsers: SupabaseUserService,
    // Proposta congelada chega como HTML e sai como PDF anexado ao card:
    // o Chromium fica no HtmlPdfService e o arquivo no bucket privado de
    // anexos (mesmo bucket das tarefas, prefixo de oportunidade).
    private readonly pdf: HtmlPdfService,
    private readonly storage: SupabaseStorageService,
    // Cartão CNPJ da Receita (lookup + update da ficha) — o mesmo serviço
    // do botão "Buscar dados" da ficha da empresa.
    private readonly companies: CompanyService,
    // Valor dos itens do card vindo do envio da proposta (2026-10-08): pelo
    // serviço de verdade, que soma os itens no valor da oportunidade e
    // registra a mudança no histórico do card.
    private readonly opportunityItems: OpportunityItemService,
  ) {}

  // Controle substituto do login nas rotas @Public() deste módulo (decisão
  // 4.5 do docs/seguranca.md): token estático no Authorization, comparado
  // em tempo constante — mesmo molde do securityToken do webhook eGestor.
  // As mensagens distinguem qual camada recusou (teste em idor.e2e-spec.ts
  // confere a mensagem exata pra provar que foi a comparação do token).
  assertTokenValido(authorizationHeader: string | undefined): void {
    const esperado = this.config.get<string>('cotacoesApiToken');
    if (!esperado) {
      throw new UnauthorizedException('COTACOES_API_TOKEN não configurado.');
    }
    const prefixo = 'Bearer ';
    if (!authorizationHeader?.startsWith(prefixo)) {
      throw new UnauthorizedException('Authorization ausente ou mal formado.');
    }
    const recebido = authorizationHeader.slice(prefixo.length);
    const a = Buffer.from(recebido);
    const b = Buffer.from(esperado);
    const valido = a.length === b.length && timingSafeEqual(a, b);
    if (!valido) {
      throw new UnauthorizedException('Token inválido.');
    }
  }

  // Quem o app de cotações enxerga: empresa de verdade, ou seja, tudo que
  // NÃO ficou parado na triagem da Prospecção. O critério era só
  // `NOT tags has 'lead-triagem'`, igual à tela Empresas, e deixava de fora
  // dois casos que existem de verdade na base (2026-09-23):
  //   • o cliente do ERP que carrega as DUAS tags ('cliente' e
  //     'lead-triagem') — 136 empresas; a graduação do eGestor só tira a
  //     tag de quem comprou depois da importação;
  //   • o lead aprovado/convertido na Prospecção cuja company manteve a
  //     tag — quem cota precisa achá-lo no mesmo dia em que ele virou
  //     negociação, que é justamente quando o cartão do Trello chega.
  // Lead ainda em triagem continua fora: não é cliente e poluiria a busca
  // do orçamento com 1.500 prospects.
  private readonly elegivelParaCotacoes: Prisma.CompanyWhereInput = {
    OR: [
      { NOT: { tags: { has: 'lead-triagem' } } },
      { tags: { has: 'cliente' } },
      {
        originLeads: {
          some: {
            OR: [{ status: 'aprovado' }, { convertedAt: { not: null } }],
          },
        },
      },
    ],
  };

  // Varredura paginada pro espelho de clientes do app de cotações.
  async listCompanies(query: ListCompaniesQueryDto): Promise<{
    itens: CompanyParaCotacoes[];
    proxima_pagina: number | null;
    agora: string;
  }> {
    const pagina = query.pagina ?? 1;
    const tamanho = query.tamanho ?? PAGE_SIZE_PADRAO;
    const workspaceId = await this.workspaceId();

    const rows = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      (tx) =>
        tx.company.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            cpfCnpj: { not: null },
            ...this.elegivelParaCotacoes,
            ...(query.desde
              ? { updatedAt: { gt: new Date(query.desde) } }
              : {}),
          },
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          skip: (pagina - 1) * tamanho,
          // Uma linha a mais só pra saber se existe próxima página.
          take: tamanho + 1,
        }),
    );

    const temMais = rows.length > tamanho;
    const itens = (temMais ? rows.slice(0, tamanho) : rows).map((c) =>
      this.paraCotacoes(c),
    );
    return {
      itens,
      proxima_pagina: temMais ? pagina + 1 : null,
      agora: new Date(Date.now() - MARCA_DAGUA_FOLGA_MS).toISOString(),
    };
  }

  // Busca ao vivo pelo app de cotações (2026-09-23). A varredura acima
  // alimenta um espelho que só atualiza de tempos em tempos; quem está
  // montando um orçamento ou cadastrando a oportunidade de um cartão do
  // Trello precisa enxergar a empresa que nasceu no CRM agora — esperar o
  // próximo tick fazia a tela dizer "não existe" e convidar a recadastrar
  // pelo CNPJ quem já estava aqui. Mesmo recorte de elegibilidade da
  // varredura, para que as duas fontes nunca discordem sobre quem existe.
  //
  // `prospeccao` (2026-10-22): CNPJ completo que não casou com nenhum
  // cliente, mas está parado na triagem da Prospecção. O cartão do Trello
  // chega com o CNPJ de quem o SDR ainda não aprovou, e a tela dizia
  // "nenhum cliente encontrado" — vai à parte (nunca misturado em `itens`)
  // pra o app oferecer "aprovar e usar" sem sair do orçamento. Só por CNPJ
  // exato: por nome traria os 1.500 prospects que o recorte acima evita.
  async buscarCompanies(query: BuscarCompaniesQueryDto): Promise<{
    itens: CompanyParaCotacoes[];
    prospeccao: ProspectParaCotacoes[];
  }> {
    const termo = (query.q ?? '').trim();
    const limite = query.tamanho ?? BUSCA_LIMITE_PADRAO;
    // Termo curto demais devolveria meia base por uma tecla solta.
    if (termo.length < BUSCA_TERMO_MIN) return { itens: [], prospeccao: [] };

    const digitos = termo.replace(/\D/g, '');
    const workspaceId = await this.workspaceId();

    const { rows, prospects } = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) => {
        const rows = await tx.company.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            cpfCnpj: { not: null },
            // Os dois OR moram em AND separados de propósito: elegibilidade
            // e texto buscado são condições diferentes, e um `OR` solto no
            // mesmo objeto sobrescreveria o outro em silêncio.
            AND: [
              this.elegivelParaCotacoes,
              {
                OR: [
                  { razaoSocial: { contains: termo, mode: 'insensitive' } },
                  { fantasia: { contains: termo, mode: 'insensitive' } },
                  // CNPJ digitado com ponto/barra ou só o começo dos
                  // dígitos — o banco guarda só dígitos.
                  ...(digitos.length >= BUSCA_CNPJ_MIN
                    ? [{ cpfCnpj: { contains: digitos } }]
                    : []),
                ],
              },
            ],
          },
          orderBy: [{ razaoSocial: 'asc' }],
          take: limite,
        });

        const procurarNaProspeccao =
          digitos.length === CNPJ_DIGITOS &&
          !rows.some((c) => c.cpfCnpj === digitos);
        const prospects = procurarNaProspeccao
          ? await tx.company.findMany({
              where: {
                workspaceId,
                deletedAt: null,
                cpfCnpj: { contains: digitos },
                NOT: this.elegivelParaCotacoes,
              },
              include: {
                originLeads: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { etapa: true, status: true },
                },
              },
              take: 1,
            })
          : [];
        return { rows, prospects };
      },
    );

    return {
      itens: rows.map((c) => this.paraCotacoes(c)),
      prospeccao: prospects.map((c) => {
        const lead = c.originLeads[0];
        return {
          ...this.paraCotacoes(c),
          etapa: lead ? ETAPA_LABEL[lead.etapa] : null,
          descartado: lead?.status === 'descartado',
        };
      }),
    };
  }

  // Cadastro vindo do app de cotações (regra 3.10 das regras de negócio):
  // entra direto em Empresas, sem tag nenhuma (o selo "Tipo" derivado das
  // tags mostra Lead), sem passar pela Prospecção. Quem envia não consulta
  // antes — a reconciliação por CNPJ é daqui: se a empresa já existe,
  // devolve a existente sem sobrescrever nada.
  async upsertCliente(dto: UpsertClienteDto): Promise<{
    company: CompanyParaCotacoes;
    ja_existia: boolean;
    receita: StatusReceitaCotacoes;
  }> {
    const workspaceId = await this.workspaceId();

    const gravado = await this.tenantContext.run<{
      company: Company;
      ja_existia: boolean;
    }>(this.ctxSistema(workspaceId), async (tx) => {
      // Edição de cliente já vinculado: atualiza a company apontada.
      if (dto.crm_company_id) {
        const atual = await tx.company.findFirst({
          where: { id: dto.crm_company_id, workspaceId },
        });
        if (!atual || atual.deletedAt) {
          throw new NotFoundException('Empresa não encontrada.');
        }
        const salvo = await tx.company.update({
          where: { id: atual.id },
          data: {
            cpfCnpj: dto.cnpj,
            razaoSocial: dto.razao_social,
            fantasia: vazioViraNull(dto.fantasia),
            logradouro: vazioViraNull(dto.logradouro),
            numero: vazioViraNull(dto.numero),
            complemento: vazioViraNull(dto.complemento),
            bairro: vazioViraNull(dto.bairro),
            cidade: vazioViraNull(dto.cidade),
            uf: vazioViraNull(dto.uf),
            cep: vazioViraNull(dto.cep),
            customFields: mesclarCamposFiscais(
              atual.customFields,
              dto,
            ) as Prisma.InputJsonValue,
          },
        });
        return { company: salvo, ja_existia: true };
      }

      // Mesma function SECURITY DEFINER que o CompanyService usa pra
      // dedupe — companies.cpf_cnpj não tem unicidade no banco, a
      // reconciliação é da aplicação.
      const existenteId = await this.findCompanyIdByCnpj(
        tx,
        workspaceId,
        dto.cnpj,
      );
      if (existenteId) {
        const existente = await tx.company.findFirst({
          where: { id: existenteId, workspaceId },
        });
        if (existente && !existente.deletedAt) {
          return { company: existente, ja_existia: true };
        }
      }

      const criada = await tx.company.create({
        data: {
          workspaceId,
          cpfCnpj: dto.cnpj,
          razaoSocial: dto.razao_social,
          fantasia: vazioViraNull(dto.fantasia),
          logradouro: vazioViraNull(dto.logradouro),
          numero: vazioViraNull(dto.numero),
          complemento: vazioViraNull(dto.complemento),
          bairro: vazioViraNull(dto.bairro),
          cidade: vazioViraNull(dto.cidade),
          uf: vazioViraNull(dto.uf),
          cep: vazioViraNull(dto.cep),
          customFields: mesclarCamposFiscais(
            null,
            dto,
          ) as Prisma.InputJsonValue,
          dtCad: new Date(),
        },
      });
      return { company: criada, ja_existia: false };
    });

    // Cliente que entra (ou é editado) pelo app de cotações está sendo
    // cotado — não é mais prospect. Os dois passos abaixo deixam a ficha
    // dele igual à de quem passou pela Prospecção (2026-10-02, pedido do
    // usuário comparando METALURGICA VISA com LISA REGINA): lead
    // qualificado/convertido e aba "Dados cadastrais" com o Cartão CNPJ.
    // Nenhum dos dois derruba o salvar: o cadastro já foi gravado.
    try {
      await this.tenantContext.run(this.ctxSistema(workspaceId), (tx) =>
        this.qualificarLead(tx, workspaceId, gravado.company.id),
      );
    } catch (err) {
      console.error('[cotacoes] qualificar lead falhou', err);
    }
    const receita = await this.preencherCartaoCnpj(
      workspaceId,
      gravado.company.id,
      dto.receita_consultada === true,
    );

    // Relê: a Receita pode ter atualizado razão social/endereço, e o
    // espelho do app precisa sair igual ao CRM.
    const final =
      receita === 'preenchido'
        ? await this.tenantContext.run(this.ctxSistema(workspaceId), (tx) =>
            tx.company.findFirst({
              where: { id: gravado.company.id, workspaceId },
            }),
          )
        : null;

    return {
      company: this.paraCotacoes(final ?? gravado.company),
      ja_existia: gravado.ja_existia,
      receita,
    };
  }

  // Lead em triagem (ou descartado) que está sendo cotado vira lead
  // convertido — mesmo efeito do "Aprovar" da Prospecção
  // (RawLeadService#approve): status aprovado, etapa Negociação/Fechamento
  // e sai a tag "lead-triagem". Empresa sem lead nenhum (cadastrada direto
  // pelo app) ganha o lead convertido que falta, pela mesma regra do card
  // de oportunidade (garantirLeadConvertido — não cria lead pra quem já
  // comprou). Lead já aprovado não é tocado.
  private async qualificarLead(
    tx: TenantTx,
    workspaceId: string,
    companyId: string,
  ): Promise<void> {
    const lead = await tx.rawLead.findFirst({
      where: { workspaceId, promotedCompanyId: companyId },
      orderBy: { createdAt: 'desc' },
    });

    if (!lead) {
      const owner = await this.resolverOwner(tx, workspaceId, null);
      await garantirLeadConvertido(tx, workspaceId, companyId, owner.userId, {
        actorUserId: null,
        origem: 'cotacoes',
      });
      return;
    }
    if (lead.status === 'aprovado') return;

    await tx.rawLead.update({
      where: { id: lead.id },
      data: {
        status: 'aprovado',
        etapa: 'negociacao',
        convertedAt: lead.convertedAt ?? new Date(),
      },
    });
    const company = await tx.company.findFirst({
      where: { id: companyId, workspaceId },
      select: { tags: true },
    });
    if (company?.tags.includes('lead-triagem')) {
      await tx.company.update({
        where: { id: companyId },
        data: { tags: company.tags.filter((t) => t !== 'lead-triagem') },
      });
    }
    // O app chama com token de integração, sem saber quem está cotando —
    // a conversão entra na Timeline como "Sistema".
    await registrarConversao(tx, {
      workspaceId,
      companyId,
      actorUserId: null,
      origem: 'cotacoes',
      razaoSocial: lead.razaoSocial,
    });
  }

  // Ficha "Dados cadastrais" (Cartão CNPJ da Receita) — mesma consulta e
  // mesma regra de merge do botão "Buscar dados" da ficha e do eGestor
  // (../../companies/cartao-cnpj.ts). Sem `forcar`, só preenche quando a
  // ficha falta. Rede fora de transação (mesmo motivo do
  // EgestorCartaoCnpjService): a BrasilAPI pode levar segundos.
  private async preencherCartaoCnpj(
    workspaceId: string,
    companyId: string,
    forcar: boolean,
  ): Promise<StatusReceitaCotacoes> {
    try {
      const ctx = this.ctxSistema(workspaceId);
      const company = await this.tenantContext.run(ctx, (tx) =>
        tx.company.findFirst({
          where: { id: companyId, workspaceId, deletedAt: null },
        }),
      );
      if (!company) return 'erro';
      const cf = (company.customFields ?? {}) as Record<string, unknown>;
      if (!forcar && cf.cnpj_lookup) return 'ja_tinha';
      const digits = (company.cpfCnpj ?? '').replace(/\D/g, '');
      if (digits.length !== 14) return 'sem_cnpj';

      const lookup = await this.companies.lookupCnpj(digits);
      const atualizacao = montarAtualizacaoCartaoCnpj(
        company,
        lookup,
        new Date(),
      );
      const membership: MembershipContext = {
        id: SYSTEM_ACTOR_USER_ID,
        userId: SYSTEM_ACTOR_USER_ID,
        workspaceId,
        role: 'owner',
        status: 'active',
      };
      await this.tenantContext.run(ctx, (tx) =>
        this.companies.update(tx, membership, company.id, atualizacao.dto, {
          semTimeline: true,
        }),
      );
      return 'preenchido';
    } catch (err) {
      console.error('[cotacoes] Cartão CNPJ falhou', err);
      return 'erro';
    }
  }

  // ============================================================
  // Trello → funil (2026-09-04)
  // ============================================================
  // A tela "Trello | Solicitação de Propostas" do app de cotações mostra
  // os cartões vivos da lista. Estas três rotas dão a ela: o que já virou
  // oportunidade, como cadastrar o que não virou, e como trazer o chat do
  // cartão pro card. Quem fala com a API do Trello é o GAS (é ele que tem
  // as credenciais) — o CRM só recebe o que ele leu.

  // Quais destes cartões já têm oportunidade viva. Uma chamada por
  // atualização da tela, não uma por linha.
  async trelloStatus(
    query: TrelloStatusQueryDto,
  ): Promise<{ itens: TrelloStatusItem[] }> {
    const cardIds = Array.from(
      new Set(
        query.card_ids
          .split(',')
          .map((id) => id.trim().toLowerCase())
          .filter((id) => id.length > 0),
      ),
    ).slice(0, TRELLO_STATUS_MAX_IDS);

    if (cardIds.length === 0) return { itens: [] };

    const workspaceId = await this.workspaceId();
    const rows = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      (tx) =>
        tx.opportunity.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            trelloCardId: { in: cardIds },
          },
          select: {
            id: true,
            trelloCardId: true,
            status: true,
            trelloSyncEm: true,
            stage: { select: { name: true } },
            company: { select: { razaoSocial: true, fantasia: true } },
            _count: { select: { comments: true, items: true } },
            items: {
              select: { id: true, name: true },
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            },
          },
        }),
    );

    return {
      itens: rows.map((row) => ({
        card_id: row.trelloCardId ?? '',
        opportunity_id: row.id,
        empresa: row.company?.razaoSocial ?? row.company?.fantasia ?? null,
        estagio: row.stage?.name ?? null,
        status: row.status,
        itens: row._count.items,
        itens_lista: (row.items ?? []).map((it) => ({
          id: it.id,
          nome: it.name,
        })),
        comentarios: row._count.comments,
        sincronizado_em: row.trelloSyncEm?.toISOString() ?? null,
      })),
    };
  }

  // "Cadastrar Oportunidade": cria o card no funil a partir do cartão.
  // Idempotente pelo cartão — apertar duas vezes (ou dois navegadores ao
  // mesmo tempo) não gera dois cards: a segunda chamada devolve a
  // existente, e a corrida real é barrada pelo índice único parcial.
  async trelloVincular(dto: TrelloVinculoDto): Promise<{
    opportunity_id: string;
    ja_existia: boolean;
    estagio: string | null;
    comentarios_novos: number;
  }> {
    const workspaceId = await this.workspaceId();
    const cardId = dto.card_id.toLowerCase();

    // Fora da transação: fala com o Supabase Auth (ver comentário do
    // método). Barato o bastante — cadastrar é ação de clique, não laço.
    const representanteUserId = await this.resolverRepresentanteUserId(
      workspaceId,
      dto.representante,
    );

    return this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) => {
        const existente = await tx.opportunity.findFirst({
          where: { workspaceId, trelloCardId: cardId, deletedAt: null },
          select: {
            id: true,
            description: true,
            stage: { select: { name: true } },
          },
        });
        if (existente) {
          await this.preencherDescricaoSeVazia(
            tx,
            existente.id,
            existente.description,
            dto.descricao,
          );
          const { novos } = await this.espelharComentarios(
            tx,
            existente.id,
            dto.comentarios,
          );
          await this.marcarSync(tx, existente.id, dto.comentarios);
          return {
            opportunity_id: existente.id,
            ja_existia: true,
            estagio: existente.stage?.name ?? null,
            comentarios_novos: novos,
          };
        }

        const company = await this.resolverCompany(tx, workspaceId, dto);
        const estagio = await this.resolverEstagioInicial(tx, workspaceId);
        const owner = await this.resolverOwner(
          tx,
          workspaceId,
          representanteUserId,
        );

        const oportunidade = await this.opportunities.create(tx, owner, {
          companyId: company.id,
          pipelineId: estagio.pipelineId,
          stageId: estagio.stageId,
          ownerUserId: owner.userId,
          amount: VALOR_INICIAL,
          currency: MOEDA_PADRAO,
          description: dto.descricao?.trim() || undefined,
          items: dto.itens ?? [],
        });

        try {
          await tx.opportunity.update({
            where: { id: oportunidade.id },
            data: {
              trelloCardId: cardId,
              trelloCardUrl: dto.card_url ?? null,
            },
          });
        } catch (erro) {
          // Índice único parcial (workspace, trello_card_id): outra
          // requisição cadastrou o mesmo cartão entre a checagem acima e
          // agora. A transação inteira volta atrás — não fica
          // oportunidade órfã — e a tela recarrega o status.
          if (
            erro instanceof Prisma.PrismaClientKnownRequestError &&
            erro.code === 'P2002'
          ) {
            throw new ConflictException(
              'Este cartão acabou de ser cadastrado no CRM. Atualize a tela.',
            );
          }
          throw erro;
        }

        const { novos } = await this.espelharComentarios(
          tx,
          oportunidade.id,
          dto.comentarios,
        );
        await this.marcarSync(tx, oportunidade.id, dto.comentarios);

        return {
          opportunity_id: oportunidade.id,
          ja_existia: false,
          estagio: estagio.stageName,
          comentarios_novos: novos,
        };
      },
      { timeoutMs: VINCULO_TIMEOUT_MS },
    );
  }

  // ============================================================
  // Valor dos itens do card (2026-10-08)
  // ============================================================
  // "Enviar proposta ao CRM" no app de cotações: cada máquina do orçamento
  // sabe a qual item do card ela responde (crm_item_id), e o preço dela na
  // versão escolhida como principal vira o valor do item. Pelo
  // OpportunityItemService: a soma dos itens vira o valor da oportunidade e
  // cada troca aparece no histórico do card. Item que não é deste card →
  // 404 (nada é gravado: tudo numa transação). Valor igual ao gravado não
  // gera evento no histórico.
  async itensValor(dto: ItensValorDto): Promise<{
    opportunity_id: string;
    atualizados: number;
    valor_oportunidade: string | null;
  }> {
    const workspaceId = await this.workspaceId();
    const membership: MembershipContext = {
      id: SYSTEM_ACTOR_USER_ID,
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner',
      status: 'active',
    };

    return this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) => {
        const opp = await tx.opportunity.findFirst({
          where: { id: dto.opportunity_id, workspaceId, deletedAt: null },
          select: { id: true },
        });
        if (!opp) throw new NotFoundException('Oportunidade não encontrada.');

        const atuais = await tx.opportunityItem.findMany({
          where: { opportunityId: opp.id },
          select: { id: true, amount: true },
        });
        const porId = new Map(atuais.map((i) => [i.id, i]));

        let atualizados = 0;
        for (const item of dto.itens) {
          const atual = porId.get(item.item_id);
          if (!atual) {
            throw new NotFoundException('Item não encontrado neste card.');
          }
          if (atual.amount !== null && Number(atual.amount) === item.amount) {
            continue;
          }
          await this.opportunityItems.update(
            tx,
            membership,
            opp.id,
            item.item_id,
            {
              amount: item.amount,
            },
          );
          atualizados++;
        }

        const final = await tx.opportunity.findUniqueOrThrow({
          where: { id: opp.id },
          select: { amount: true },
        });
        return {
          opportunity_id: opp.id,
          atualizados,
          valor_oportunidade:
            final.amount === null ? null : String(final.amount),
        };
      },
      { timeoutMs: VINCULO_TIMEOUT_MS },
    );
  }

  // ============================================================
  // Situação do orçamento → estágio do card (2026-10-08)
  // ============================================================
  // O app de cotações chama ao vincular um orçamento ao card e ao trocar a
  // situação de um orçamento já vinculado; quem decide QUANDO pedir é o app
  // (lá estão os orçamentos e a situação de cada um). Aqui ficam só as
  // regras do funil:
  //  • só AVANÇA — card já no estágio pedido ou adiante (alguém arrastou pra
  //    Negociação) fica onde está; o app nunca puxa card pra trás;
  //  • só oportunidade ABERTA — ganhar/perder é decisão de gente;
  //  • move pelo OpportunityService.update, não por update direto: é ele
  //    que valida o estágio, cuida do SLA e grava o `stage_change` no
  //    histórico do card (ator = usuário-sistema da integração);
  //  • estágio resolvido por NOME no funil do card, nunca por UUID.
  async avancarEstagio(dto: AvancarEstagioDto): Promise<{
    opportunity_id: string;
    movido: boolean;
    estagio: string | null;
    de: string | null;
    motivo:
      | 'movido'
      | 'ja_no_estagio'
      | 'ja_adiante'
      | 'fechada'
      | 'estagio_inexistente'
      | 'fora_da_origem';
  }> {
    const workspaceId = await this.workspaceId();
    const alvoNome = ESTAGIO_POR_ETAPA[dto.etapa];
    const origemNome = ORIGEM_EXIGIDA[dto.etapa];
    const membership: MembershipContext = {
      id: SYSTEM_ACTOR_USER_ID,
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner',
      status: 'active',
    };

    // Uma segunda tentativa só para a corrida do lock otimista (alguém
    // salvou o card entre a leitura da `version` e o update).
    for (let tentativa = 0; ; tentativa++) {
      try {
        return await this.tenantContext.run(
          this.ctxSistema(workspaceId),
          async (tx) => {
            const opp = await tx.opportunity.findFirst({
              where: { id: dto.opportunity_id, workspaceId, deletedAt: null },
              include: { stage: true },
            });
            if (!opp)
              throw new NotFoundException('Oportunidade não encontrada.');

            const base = {
              opportunity_id: opp.id,
              de: opp.stage?.name ?? null,
            };
            if (opp.status !== 'open') {
              return {
                ...base,
                movido: false,
                estagio: base.de,
                motivo: 'fechada' as const,
              };
            }

            const alvo = await tx.stage.findFirst({
              where: {
                pipelineId: opp.pipelineId,
                name: { equals: alvoNome, mode: 'insensitive' },
              },
            });
            if (!alvo) {
              return {
                ...base,
                movido: false,
                estagio: base.de,
                motivo: 'estagio_inexistente' as const,
              };
            }
            if (opp.stageId === alvo.id) {
              return {
                ...base,
                movido: false,
                estagio: alvo.name,
                motivo: 'ja_no_estagio' as const,
              };
            }
            if (opp.stage && opp.stage.order > alvo.order) {
              return {
                ...base,
                movido: false,
                estagio: base.de,
                motivo: 'ja_adiante' as const,
              };
            }
            if (
              origemNome &&
              (opp.stage?.name ?? '').trim().toLowerCase() !==
                origemNome.toLowerCase()
            ) {
              return {
                ...base,
                movido: false,
                estagio: base.de,
                motivo: 'fora_da_origem' as const,
              };
            }

            await this.opportunities.update(tx, membership, opp.id, {
              version: opp.version,
              stageId: alvo.id,
            });
            return {
              ...base,
              movido: true,
              estagio: alvo.name,
              motivo: 'movido' as const,
            };
          },
        );
      } catch (erro) {
        if (erro instanceof OptimisticConcurrencyException && tentativa === 0)
          continue;
        throw erro;
      }
    }
  }

  // "Sincronizar": traz pro chat do card o que foi conversado no cartão
  // depois do cadastro. Acrescenta mensagem nova e atualiza o texto de
  // mensagem do Trello corrigida lá (com a versão anterior no histórico
  // de edição) — o que foi escrito no CRM nunca é tocado e nada é
  // apagado, então apertar de novo é sempre seguro. Cartão sem
  // oportunidade → 404 (a tela oferece "Cadastrar").
  async trelloSincronizarComentarios(dto: TrelloComentariosDto): Promise<{
    opportunity_id: string;
    novos: number;
    editados: number;
    recebidos: number;
  }> {
    const workspaceId = await this.workspaceId();
    const cardId = dto.card_id.toLowerCase();

    return this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) => {
        const oportunidade = await tx.opportunity.findFirst({
          where: { workspaceId, trelloCardId: cardId, deletedAt: null },
          select: { id: true, description: true },
        });
        if (!oportunidade) {
          throw new NotFoundException(
            'Este cartão ainda não tem oportunidade no CRM.',
          );
        }

        await this.preencherDescricaoSeVazia(
          tx,
          oportunidade.id,
          oportunidade.description,
          dto.descricao,
        );

        const { novos, editados } = await this.espelharComentarios(
          tx,
          oportunidade.id,
          dto.comentarios,
        );
        await tx.opportunity.update({
          where: { id: oportunidade.id },
          data: { trelloSyncEm: new Date() },
        });

        return {
          opportunity_id: oportunidade.id,
          novos,
          editados,
          recebidos: dto.comentarios.length,
        };
      },
      { timeoutMs: VINCULO_TIMEOUT_MS },
    );
  }

  // "Enviar proposta ao CRM" (gama-webapp/planejamento/integracao-crm.md §18).
  // O app de cotações monta e CONGELA o documento no servidor dele e manda o
  // HTML pra cá; aqui ele vira PDF e entra como anexo do card.
  //
  // Quatro coisas que o código não deixa óbvias:
  // - **O render NÃO acontece dentro da transação.** Virar 28 páginas A4 em
  //   PDF leva segundos; segurar uma transação aberta nesse tempo prende
  //   conexão do pool e pode estourar o timeout do tenant. São duas idas ao
  //   banco (achar/conferir antes, gravar depois) com o trabalho pesado no
  //   meio, fora de transação.
  // - **Idempotência pelo código de verificação**: clique repetido (ou
  //   reenvio depois de um erro de rede) devolve o anexo que já existe em vez
  //   de duplicar a proposta no card. Documento novo tem código novo, porque
  //   o outro lado congela uma versão nova a cada envio.
  // - **`uploadedBy` é o usuário-sistema**, e o CRM só deixa remover anexo
  //   quem enviou (OpportunityAttachmentService.remove). É isso — e não uma
  //   permissão nova — que faz a proposta oficial não poder ser apagada nem
  //   trocada por ninguém pela tela.
  // - **O hash é conferido antes de gerar o PDF.** Se o que chegou não bate
  //   com o que está congelado do outro lado, nada é gravado: PDF que não
  //   corresponde a um registro é pior que nenhum PDF.
  async upsertProposta(dto: UpsertPropostaDto): Promise<{
    opportunity_id: string;
    attachment_id: string;
    file_name: string;
    storage_path: string;
    pdf_sha256: string;
    bytes: number;
    ja_existia: boolean;
  }> {
    const workspaceId = await this.workspaceId();
    const codigo = dto.codigo_verificacao.toUpperCase();
    const fileName = nomeArquivoProposta(dto.nome_arquivo);
    // A pasta do orçamento no caminho é o que permite achar o PDF anterior da
    // MESMA versão do orçamento e trocá-lo (decisão do Tiago, 2026-09-28: o card
    // fica só com o envio mais recente de cada versão). Cada versão (3.0, 3.1)
    // é um orçamento próprio do outro lado, então pasta = número + versão.
    const pastaOrcamento = `${workspaceId}/opportunities/${dto.opportunity_id}/orc-${dto.orcamento_id}/`;
    // O código de verificação vira subpasta (2026-10-16): saiu do nome do
    // arquivo pra ele ficar igual ao do "Salvar como PDF", mas continua sendo
    // a chave da idempotência. E o arquivo no Storage leva o nome da proposta,
    // não um uuid — "Abrir em nova aba" e salvar sugere o nome certo.
    const pastaCodigo = `${pastaOrcamento}${codigo}/`;

    const jaGravado = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) => {
        const oportunidade = await tx.opportunity.findFirst({
          where: { id: dto.opportunity_id, workspaceId, deletedAt: null },
          select: { id: true },
        });
        if (!oportunidade) {
          // 404 e não 403: recurso fora do escopo do token não revela que
          // existe em outro workspace (seção 8 do plano).
          throw new NotFoundException('Oportunidade não encontrada.');
        }
        // Envio anterior deste mesmo código: pela subpasta, ou pelo nome no
        // formato antigo ("… (CODIGO).pdf"), de antes de 2026-10-16.
        const existente = await tx.opportunityAttachment.findFirst({
          where: {
            opportunityId: oportunidade.id,
            uploadedBy: SYSTEM_ACTOR_USER_ID,
            OR: [
              { storagePath: { startsWith: pastaCodigo } },
              {
                storagePath: { startsWith: pastaOrcamento },
                fileName: { endsWith: `(${codigo}).pdf` },
              },
            ],
          },
          select: { id: true, fileName: true, storagePath: true, sizeBytes: true },
        });
        return existente;
      },
    );

    if (jaGravado) {
      return {
        opportunity_id: dto.opportunity_id,
        attachment_id: jaGravado.id,
        file_name: jaGravado.fileName,
        storage_path: jaGravado.storagePath,
        pdf_sha256: '',
        bytes: Number(jaGravado.sizeBytes ?? 0),
        ja_existia: true,
      };
    }

    const hashRecebido = createHash('sha256')
      .update(dto.html, 'utf8')
      .digest('hex');
    if (hashRecebido !== dto.html_sha256.toLowerCase()) {
      throw new BadRequestException(
        'O HTML recebido não corresponde ao hash da proposta congelada.',
      );
    }

    const pdf = await this.pdf.renderPdf(dto.html);
    const pdfSha256 = createHash('sha256').update(pdf).digest('hex');
    // uuid como pasta, não no nome: o arquivo segue com o nome da proposta e
    // um reenvio do mesmo código que tenha morrido entre o upload e o insert
    // não esbarra no objeto que ficou no Storage.
    const storagePath = `${pastaCodigo}${randomUUID()}/${nomeArquivoStorage(fileName)}`;
    await this.storage.upload(storagePath, pdf, 'application/pdf');

    const attachment = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) =>
        tx.opportunityAttachment.create({
          data: {
            opportunityId: dto.opportunity_id,
            storagePath,
            fileName,
            mimeType: 'application/pdf',
            sizeBytes: pdf.length,
            uploadedBy: SYSTEM_ACTOR_USER_ID,
            publishedAt: new Date(),
          },
          select: { id: true },
        }),
    );

    // Reenvio da mesma versão: o anexo anterior sai do card. Só os da
    // integração (uploadedBy = usuário-sistema) e só os desta versão do
    // orçamento — anexo que alguém subiu à mão nunca é tocado. O PDF novo já
    // está gravado: se a limpeza falhar, o pior caso são dois PDFs no card.
    const anteriores = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) => {
        const rows = await tx.opportunityAttachment.findMany({
          where: {
            opportunityId: dto.opportunity_id,
            uploadedBy: SYSTEM_ACTOR_USER_ID,
            storagePath: { startsWith: pastaOrcamento },
            id: { not: attachment.id },
          },
          select: { id: true, storagePath: true },
        });
        if (rows.length) {
          await tx.opportunityAttachment.deleteMany({
            where: { id: { in: rows.map((r) => r.id) } },
          });
        }
        return rows;
      },
    );
    for (const antigo of anteriores) {
      await this.storage.remove(antigo.storagePath).catch((erro: unknown) => {
        console.error('[cotacoes] PDF anterior ficou no storage', erro);
      });
    }

    return {
      opportunity_id: dto.opportunity_id,
      attachment_id: attachment.id,
      file_name: fileName,
      storage_path: storagePath,
      pdf_sha256: pdfSha256,
      bytes: pdf.length,
      ja_existia: false,
    };
  }

  // "O que o funil está pedindo" — uma linha por ITEM de solicitação, para a
  // Fila de cotação do app (gama-webapp, planejamento/integracao-crm.md §19).
  //
  // Quatro decisões que o código não deixa óbvias:
  // - **O CRM não sabe o que já foi cotado**, e é de propósito: quem cruza é o
  //   app, que tem os orçamentos e guarda `crm_item_id` em cada linha de
  //   produto. Trazer "cotado" para cá exigiria o CRM conhecer orçamento —
  //   duas verdades sobre o mesmo fato.
  // - **Só oportunidade ABERTA**: ganha/perde saiu do fluxo de cotação. A
  //   carga histórica ('historico-cotacoes') fica fora por padrão — ela não
  //   passou pela jornada e encheria a fila com pedido que ninguém vai cotar.
  // - **Sai o pedido inteiro, mesmo sem itens**: solicitação cadastrada sem
  //   checklist aparece com a lista vazia, e é assim que quem cota descobre
  //   que falta detalhar — some-la seria esconder trabalho.
  // - **Nomes de responsável vêm do Supabase Auth em UMA chamada** para todos
  //   os donos da página (`getIdentities`), fora de transação: é requisição
  //   HTTP, e segurar transação esperando HTTP já estourou o pool aqui antes.
  async fila(query: FilaQueryDto): Promise<{
    atualizado_em: string;
    truncado: boolean;
    solicitacoes: SolicitacaoDaFila[];
  }> {
    const limite = query.limite ?? 200;
    const workspaceId = await this.workspaceId();

    const oportunidades = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      async (tx) =>
        tx.opportunity.findMany({
          where: {
            workspaceId,
            status: 'open',
            deletedAt: null,
            // Fora a carga histórica — mas `NOT: { origem: ... }` sozinho é uma
            // armadilha: vira `origem <> '...'` no SQL, que dá NULL para quem tem
            // `origem` nula, e NULL não passa no WHERE. Oportunidade nascida no
            // CRM tem origem NULL (o caso das 21 abertas em 2026-10-01), então o
            // filtro esvaziava a fila inteira em silêncio — ela respondia 200 com
            // lista vazia, que a tela lê como "nada pendente". O OR explícito diz
            // o que se quer: não é a carga histórica, incluindo quem não tem
            // origem nenhuma.
            ...(query.incluir_historico
              ? {}
              : {
                  OR: [
                    { origem: null },
                    { origem: { not: 'historico-cotacoes' } },
                  ],
                }),
          },
          select: {
            id: true,
            description: true,
            amount: true,
            createdAt: true,
            updatedAt: true,
            position: true,
            slaDueDate: true,
            trelloCardId: true,
            trelloCardUrl: true,
            ownerUserId: true,
            company: {
              select: {
                id: true,
                razaoSocial: true,
                fantasia: true,
                cpfCnpj: true,
                uf: true,
              },
            },
            stage: { select: { id: true, name: true, order: true } },
            items: {
              select: { id: true, name: true, amount: true, position: true },
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            },
          },
          orderBy: [{ updatedAt: 'asc' }],
          take: limite + 1,
        }),
    );

    const truncado = oportunidades.length > limite;
    const pagina = truncado ? oportunidades.slice(0, limite) : oportunidades;

    const identidades = await this.supabaseUsers.getIdentities(
      Array.from(new Set(pagina.map((o) => o.ownerUserId))),
    );

    return {
      atualizado_em: new Date().toISOString(),
      truncado,
      solicitacoes: pagina.map((o) => {
        const dono = identidades.get(o.ownerUserId);
        return {
          opportunity_id: o.id,
          empresa: {
            id: o.company.id,
            nome: o.company.razaoSocial || o.company.fantasia || '',
            cnpj: (o.company.cpfCnpj ?? '').replace(/\D/g, ''),
            uf: o.company.uf ?? '',
          },
          etapa: o.stage.name,
          etapa_posicao: o.stage.order,
          // Ordem do card dentro da etapa no quadro (null = nunca arrastado):
          // a Fila de cotação do app ordena igual ao pipeline.
          posicao: o.position ?? null,
          representante: dono?.name ?? dono?.login ?? '',
          descricao: o.description ?? '',
          valor: o.amount == null ? null : Number(o.amount),
          criado_em: o.createdAt.toISOString(),
          atualizado_em: o.updatedAt.toISOString(),
          // Vazio = proposta ainda pendente (o CRM zera quando ela sai das
          // etapas de proposta). É o mesmo sinal do SLA da tela do CRM.
          proposta_em: o.slaDueDate ? o.slaDueDate.toISOString() : null,
          trello_card_id: o.trelloCardId ?? null,
          trello_card_url: o.trelloCardUrl ?? null,
          itens: o.items.map((i) => ({
            item_id: i.id,
            descricao: i.name,
            valor: i.amount == null ? null : Number(i.amount),
          })),
        };
      }),
    };
  }

  diagnosticoPdf(): Promise<{ ok: boolean; versao?: string; erro?: string }> {
    return this.pdf.diagnostico();
  }

  // Grava as mensagens do cartão que ainda não estão no card. A chave de
  // idempotência é `external_ref` (id da action no Trello): o que já foi
  // espelhado não entra de novo, e comentário escrito por gente no CRM
  // (external_ref nulo) nunca é tocado.
  //
  // Mensagem já espelhada cujo texto mudou no Trello (corrigida lá depois)
  // ganha o texto novo aqui (2026-10-16) — com a versão anterior guardada
  // no histórico de edição do comentário, mesmo registro da edição feita
  // pela tela, e o usuário de sistema como quem editou.
  private async espelharComentarios(
    tx: TenantTx,
    opportunityId: string,
    comentarios: TrelloComentarioDto[] | undefined,
  ): Promise<{ novos: number; editados: number }> {
    const lista = normalizarComentarios(comentarios);
    if (lista.length === 0) return { novos: 0, editados: 0 };

    const jaEspelhados = await tx.opportunityComment.findMany({
      where: { opportunityId, externalRef: { in: lista.map((c) => c.ref) } },
      select: { id: true, externalRef: true, body: true },
    });
    const porRef = new Map(
      jaEspelhados.flatMap((c) =>
        c.externalRef ? [[c.externalRef, c] as const] : [],
      ),
    );

    let editados = 0;
    for (const c of lista) {
      const atual = porRef.get(c.ref);
      if (!atual || atual.body === c.body) continue;
      const agora = new Date();
      await tx.opportunityCommentEdit.create({
        data: {
          commentId: atual.id,
          opportunityId,
          bodyBefore: atual.body,
          bodyAfter: c.body,
          editedByUserId: SYSTEM_ACTOR_USER_ID,
          editedAt: agora,
        },
      });
      await tx.opportunityComment.update({
        where: { id: atual.id },
        data: { body: c.body, editedAt: agora },
      });
      editados += 1;
    }

    const novos = lista.filter((c) => !porRef.has(c.ref));
    if (novos.length === 0) return { novos: 0, editados };

    // skipDuplicates além do filtro acima: entre a leitura e a escrita,
    // outra sincronização pode ter gravado a mesma mensagem.
    const resultado = await tx.opportunityComment.createMany({
      data: novos.map((c) => ({
        opportunityId,
        authorUserId: SYSTEM_ACTOR_USER_ID,
        body: c.body,
        externalRef: c.ref,
        // Quem escreveu no Trello não é usuário do CRM: o nome vai em
        // coluna própria (a tela mostra ele no lugar do id de sistema).
        externalAuthor: c.author,
        // A data é a do Trello, não a do espelhamento: o chat do card
        // fica na ordem em que a conversa aconteceu de verdade.
        createdAt: c.createdAt,
      })),
      skipDuplicates: true,
    });
    return { novos: resultado.count, editados };
  }

  // Descrição do cartão numa oportunidade que já existe: só preenche o
  // que está vazio. Reespelhar o cartão nunca pode apagar o que alguém
  // escreveu no CRM — mesma regra do chat, que só acrescenta. Serve de
  // correção pras oportunidades criadas antes de a descrição viajar.
  private async preencherDescricaoSeVazia(
    tx: TenantTx,
    opportunityId: string,
    atual: string | null,
    descricao: string | undefined,
  ): Promise<void> {
    const texto = descricao?.trim() ?? '';
    if (!texto || (atual ?? '').trim()) return;
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { description: texto },
    });
  }

  private async marcarSync(
    tx: TenantTx,
    opportunityId: string,
    comentarios: TrelloComentarioDto[] | undefined,
  ): Promise<void> {
    if (!comentarios) return;
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { trelloSyncEm: new Date() },
    });
  }

  // Empresa da oportunidade: o id quando o app já tem o vínculo no
  // espelho (caso normal desde a fase 1), o CNPJ como reserva.
  private async resolverCompany(
    tx: TenantTx,
    workspaceId: string,
    dto: TrelloVinculoDto,
  ): Promise<Company> {
    if (dto.crm_company_id) {
      const company = await tx.company.findFirst({
        where: { id: dto.crm_company_id, workspaceId },
      });
      if (!company || company.deletedAt) {
        throw new NotFoundException('Empresa não encontrada.');
      }
      return company;
    }

    if (dto.cnpj) {
      const id = await this.findCompanyIdByCnpj(tx, workspaceId, dto.cnpj);
      const company = id
        ? await tx.company.findFirst({ where: { id, workspaceId } })
        : null;
      if (!company || company.deletedAt) {
        throw new NotFoundException(
          'Nenhuma empresa com este CNPJ no CRM. Cadastre o cliente antes.',
        );
      }
      return company;
    }

    throw new BadRequestException(
      'Informe a empresa da oportunidade (crm_company_id ou cnpj).',
    );
  }

  // Funil padrão + estágio de entrada, resolvidos por nome/ordem. Nunca
  // por UUID em código: os estágios nascem do seed e podem ser recriados.
  private async resolverEstagioInicial(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<{ pipelineId: string; stageId: string; stageName: string }> {
    const pipeline =
      (await tx.pipeline.findFirst({
        where: { workspaceId, isDefault: true },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await tx.pipeline.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
      }));
    if (!pipeline) {
      throw new BadRequestException('Nenhum funil configurado no CRM.');
    }

    const stage =
      (await tx.stage.findFirst({
        where: {
          pipelineId: pipeline.id,
          name: { equals: ESTAGIO_INICIAL_NOME, mode: 'insensitive' },
        },
      })) ??
      (await tx.stage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { order: 'asc' },
      }));
    if (!stage) {
      throw new BadRequestException('O funil do CRM não tem nenhum estágio.');
    }

    return {
      pipelineId: pipeline.id,
      stageId: stage.id,
      stageName: stage.name,
    };
  }

  // Representante da solicitação a partir do QUADRO do Trello: cada
  // representante tem o quadro dele ("LAURO BRANDÃO - SC"), então o
  // quadro diz de quem é a cotação. Casa com o nome do membro do CRM —
  // mesmo recurso que o módulo do eGestor usa pra casar vendedor do ERP
  // com membro daqui.
  //
  // Roda ANTES da transação de propósito: `getIdentities` é uma
  // requisição HTTP ao Supabase Auth (nome/login vivem em auth.users), e
  // segurar transação aberta esperando HTTP já estourou o pool antes.
  // Sem casamento (quadro de quem não é membro, dois membros parecidos),
  // devolve null e cai no dono padrão — nunca chuta.
  private async resolverRepresentanteUserId(
    workspaceId: string,
    representante: string | undefined,
  ): Promise<string | null> {
    const alvo = normalizarTexto(representante);
    if (!alvo) return null;

    const membros = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      (tx) =>
        tx.membership.findMany({
          where: { workspaceId, status: 'active' },
          select: { userId: true },
        }),
    );
    if (membros.length === 0) return null;

    const identidades = await this.supabaseUsers.getIdentities(
      membros.map((m) => m.userId),
    );

    const palavras = alvo.split(' ').filter((p) => p.length > 0);
    const casados: string[] = [];

    for (const [userId, identidade] of identidades) {
      const nome = normalizarTexto(identidade.name ?? identidade.login);
      if (!nome) continue;
      const primeiroNome = nome.split(' ')[0];
      if (primeiroNome.length < NOME_MIN_PARA_CASAR) continue;

      // "LAURO BRANDÃO - SC" casa com "Lauro"; "ARLEISANDRO SALDANHA"
      // casa com "Arlei" (o nome do membro é o começo da palavra).
      const casou = palavras.some((palavra) =>
        palavra.startsWith(primeiroNome),
      );
      if (casou) casados.push(userId);
    }

    // Dois membros parecidos = ambiguidade. Melhor cair no dono padrão do
    // que atribuir a cotação pra pessoa errada.
    return casados.length === 1 ? casados[0] : null;
  }

  // Dono da oportunidade criada pela integração. `owner_user_id` é NOT
  // NULL e a oportunidade precisa de alguém responsável desde o primeiro
  // minuto: o representante do quadro do Trello quando dá pra saber,
  // senão o membro de COTACOES_DEFAULT_OWNER_USER_ID e, sem ele, o dono
  // do workspace. Remanejável depois na tela do CRM.
  private async resolverOwner(
    tx: TenantTx,
    workspaceId: string,
    representanteUserId: string | null,
  ): Promise<MembershipContext> {
    const representante = representanteUserId
      ? await tx.membership.findFirst({
          where: { workspaceId, userId: representanteUserId, status: 'active' },
        })
      : null;

    const configurado = this.config.get<string>('cotacoesDefaultOwnerUserId');
    const escolhido =
      representante ??
      (configurado
        ? await tx.membership.findFirst({
            where: { workspaceId, userId: configurado, status: 'active' },
          })
        : null);

    const membership =
      escolhido ??
      (await tx.membership.findFirst({
        where: { workspaceId, status: 'active', role: 'owner' },
        orderBy: { createdAt: 'asc' },
      }));

    if (!membership) {
      throw new BadRequestException(
        'Nenhum membro ativo para receber a oportunidade. Configure COTACOES_DEFAULT_OWNER_USER_ID.',
      );
    }

    return {
      id: membership.id,
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
      status: membership.status,
      permissions: membership.permissions,
    };
  }

  private async findCompanyIdByCnpj(
    tx: TenantTx,
    workspaceId: string,
    cnpjDigits: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string | null }>>(
      Prisma.sql`SELECT public.find_company_id_by_cnpj(${workspaceId}::uuid, ${cnpjDigits}) AS id`,
    );
    return rows[0]?.id ?? null;
  }

  private async workspaceId(): Promise<string> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { slug: DEFAULT_WORKSPACE_SLUG },
      select: { id: true },
    });
    return workspace.id;
  }

  private ctxSistema(workspaceId: string) {
    return {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };
  }

  private paraCotacoes(c: Company): CompanyParaCotacoes {
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    return {
      id: c.id,
      cnpj: (c.cpfCnpj ?? '').replace(/\D/g, ''),
      razao_social: c.razaoSocial,
      fantasia: c.fantasia,
      logradouro: c.logradouro,
      numero: c.numero,
      complemento: c.complemento,
      bairro: c.bairro,
      cidade: c.cidade,
      uf: c.uf,
      cep: c.cep,
      indicador_ie: textoOuNull(cf['indicador_ie']),
      inscricao_estadual: textoOuNull(cf['inscricao_estadual']),
      atualizado_em: c.updatedAt.toISOString(),
    };
  }
}

// Nome do anexo como aparece no card. Igual ao que o "Salvar como PDF" do app
// de cotações sugere (pedido do Tiago, 2026-10-16 — antes ia com o código de
// verificação no fim): o app já manda pronto ("Proposta 3057-26 Ver. 3.0
// MAQUINA CLIENTE LTDA"), aqui só sai o que o Windows não aceita em nome de
// arquivo, com a mesma troca por "-" que o app faz. Acento fica — isto é só o
// texto gravado no banco; a chave no Storage é a de nomeArquivoStorage.
export function nomeArquivoProposta(base: string): string {
  const limpo = base
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
    .replace(/[.\s]+$/, '');
  return `${limpo.length > 0 ? limpo : 'Proposta'}.pdf`;
}

// O mesmo nome como chave no Storage, que só aceita ASCII: acento vira a letra
// sem acento e o resto fora do conjunto seguro vira "_". As regras de
// saneamento são as mesmas do buildStoragePath do OpportunityAttachmentService
// (path traversal e caractere fora do conjunto seguro) — quem mexer numa,
// olhe a outra.
export function nomeArquivoStorage(fileName: string): string {
  return fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ._()-]/g, '_')
    .replace(/\.{2,}/g, '_');
}

// Uma solicitação do funil como a Fila de cotação do app precisa vê-la: o
// pedido (empresa, etapa, responsável) e os itens pedidos. Nada de orçamento —
// quem sabe o que já foi cotado é o app.
export interface SolicitacaoDaFila {
  opportunity_id: string;
  empresa: { id: string; nome: string; cnpj: string; uf: string };
  etapa: string;
  etapa_posicao: number;
  posicao: number | null;
  representante: string;
  descricao: string;
  valor: number | null;
  criado_em: string;
  atualizado_em: string;
  proposta_em: string | null;
  trello_card_id: string | null;
  trello_card_url: string | null;
  itens: Array<{ item_id: string; descricao: string; valor: number | null }>;
}

interface ComentarioEspelhado {
  ref: string;
  body: string;
  author: string | null;
  createdAt: Date;
}

// Limpa o lote de mensagens antes de gravar: descarta comentário vazio,
// tira repetição de ref dentro do próprio lote e ordena por data (o
// Trello devolve do mais novo pro mais antigo).
//
// O nome de quem escreveu vai pra `external_author`, não pro campo de
// autor do CRM: quem comentou no Trello não é usuário daqui.
// `author_user_id` fica com o mesmo sentinela de sistema das outras
// integrações — atribuir a mensagem a um membro de verdade faria parecer
// que ele escreveu aquilo. A tela mostra o nome externo.
function normalizarComentarios(
  comentarios: TrelloComentarioDto[] | undefined,
): ComentarioEspelhado[] {
  if (!comentarios || comentarios.length === 0) return [];

  const porRef = new Map<string, ComentarioEspelhado>();
  for (const comentario of comentarios) {
    const texto = (comentario.texto ?? '').trim();
    if (!texto) continue;

    const ref = comentario.ref.toLowerCase();
    if (porRef.has(ref)) continue;

    const autor = (comentario.autor ?? '').trim();
    const data = comentario.em ? new Date(comentario.em) : null;
    porRef.set(ref, {
      ref,
      body: texto,
      author: autor.length > 0 ? autor : null,
      createdAt: data && !Number.isNaN(data.getTime()) ? data : new Date(),
    });
  }

  return [...porRef.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

// Comparação de nome sem depender de acento nem caixa: o quadro do Trello
// vem em caixa alta ("DARLÃ - MG") e o nome do membro vem como foi
// cadastrado ("Darlã").
function normalizarTexto(valor: string | undefined | null): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function vazioViraNull(valor: string | undefined): string | null {
  const t = (valor ?? '').trim();
  return t.length > 0 ? t : null;
}

// indicador_ie/inscricao_estadual moram em companies.custom_fields (mesmas
// chaves do eGestor — egestor-contato-correction.service.ts). Merge por cima
// do que a company já tem pra preservar as demais chaves (cnpj_lookup etc.).
// Campo ausente no DTO não mexe na chave; enviado vazio remove (write-through:
// o formulário da cotação é a verdade, limpar lá limpa aqui).
function mesclarCamposFiscais(
  atuais: Prisma.JsonValue | null | undefined,
  dto: UpsertClienteDto,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    atuais && typeof atuais === 'object' && !Array.isArray(atuais)
      ? { ...(atuais as Record<string, unknown>) }
      : {};
  for (const chave of ['indicador_ie', 'inscricao_estadual'] as const) {
    const valor = dto[chave];
    if (valor === undefined) continue;
    const t = valor.trim();
    if (t.length > 0) base[chave] = t;
    else delete base[chave];
  }
  return base;
}

// custom_fields é jsonb livre — só string/número contam como valor; objeto,
// array ou boolean ali seria dado corrompido e vira null (nunca
// "[object Object]" no espelho).
function textoOuNull(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const t = String(valor).trim();
  return t.length > 0 ? t : null;
}
