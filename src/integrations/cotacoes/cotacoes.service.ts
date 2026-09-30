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
import { SupabaseUserService } from '../../memberships/supabase-user.service';
import { HtmlPdfService } from '../../pdf/html-pdf.service';
import { OpportunityService } from '../../opportunities/opportunity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseStorageService } from '../../storage/supabase-storage.service';
import {
  TenantContextService,
  type TenantTx,
} from '../../tenancy/tenant-context.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import { BuscarCompaniesQueryDto } from './dto/buscar-companies-query.dto';
import { FilaQueryDto } from './dto/fila-query.dto';
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

// Busca ao vivo do app de cotações: o usuário escolhe uma empresa numa
// lista curta, não pagina resultado. Mínimos existem pra uma tecla solta
// não varrer a base inteira; o CNPJ aceita menos porque 4 dígitos já
// separam bem (e é assim que se digita um CNPJ pela metade).
const BUSCA_LIMITE_PADRAO = 20;
const BUSCA_TERMO_MIN = 3;
const BUSCA_CNPJ_MIN = 4;

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
  async buscarCompanies(
    query: BuscarCompaniesQueryDto,
  ): Promise<{ itens: CompanyParaCotacoes[] }> {
    const termo = (query.q ?? '').trim();
    const limite = query.tamanho ?? BUSCA_LIMITE_PADRAO;
    // Termo curto demais devolveria meia base por uma tecla solta.
    if (termo.length < BUSCA_TERMO_MIN) return { itens: [] };

    const digitos = termo.replace(/\D/g, '');
    const workspaceId = await this.workspaceId();

    const rows = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      (tx) =>
        tx.company.findMany({
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
        }),
    );

    return { itens: rows.map((c) => this.paraCotacoes(c)) };
  }

  // Cadastro vindo do app de cotações (regra 3.10 das regras de negócio):
  // entra direto em Empresas, sem tag nenhuma (o selo "Tipo" derivado das
  // tags mostra Lead), sem passar pela Prospecção. Quem envia não consulta
  // antes — a reconciliação por CNPJ é daqui: se a empresa já existe,
  // devolve a existente sem sobrescrever nada.
  async upsertCliente(dto: UpsertClienteDto): Promise<{
    company: CompanyParaCotacoes;
    ja_existia: boolean;
  }> {
    const workspaceId = await this.workspaceId();

    return this.tenantContext.run(this.ctxSistema(workspaceId), async (tx) => {
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
        return { company: this.paraCotacoes(salvo), ja_existia: true };
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
          return {
            company: this.paraCotacoes(existente),
            ja_existia: true,
          };
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
      return { company: this.paraCotacoes(criada), ja_existia: false };
    });
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
          const novos = await this.espelharComentarios(
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

        const novos = await this.espelharComentarios(
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

  // "Sincronizar": traz pro chat do card o que foi conversado no cartão
  // depois do cadastro. Só acrescenta mensagem nova — nada do que existe
  // no card é sobrescrito ou apagado, então apertar de novo é sempre
  // seguro. Cartão sem oportunidade → 404 (a tela oferece "Cadastrar").
  async trelloSincronizarComentarios(dto: TrelloComentariosDto): Promise<{
    opportunity_id: string;
    novos: number;
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

        const novos = await this.espelharComentarios(
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
    const fileName = nomeArquivoProposta(dto.nome_arquivo, codigo);

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
        const existente = await tx.opportunityAttachment.findFirst({
          where: { opportunityId: oportunidade.id, fileName },
          select: { id: true, storagePath: true, sizeBytes: true },
        });
        return existente;
      },
    );

    if (jaGravado) {
      return {
        opportunity_id: dto.opportunity_id,
        attachment_id: jaGravado.id,
        file_name: fileName,
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
    const storagePath = `${workspaceId}/opportunities/${dto.opportunity_id}/${randomUUID()}-${fileName}`;
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
          },
          select: { id: true },
        }),
    );

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
            ...(query.incluir_historico
              ? {}
              : { NOT: { origem: 'historico-cotacoes' } }),
          },
          select: {
            id: true,
            description: true,
            amount: true,
            createdAt: true,
            updatedAt: true,
            slaDueDate: true,
            trelloCardId: true,
            trelloCardUrl: true,
            ownerUserId: true,
            company: {
              select: { id: true, razaoSocial: true, fantasia: true, cpfCnpj: true, uf: true },
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
  private async espelharComentarios(
    tx: TenantTx,
    opportunityId: string,
    comentarios: TrelloComentarioDto[] | undefined,
  ): Promise<number> {
    const lista = normalizarComentarios(comentarios);
    if (lista.length === 0) return 0;

    const jaEspelhados = await tx.opportunityComment.findMany({
      where: { opportunityId, externalRef: { in: lista.map((c) => c.ref) } },
      select: { externalRef: true },
    });
    const conhecidos = new Set(
      jaEspelhados.map((c) => c.externalRef).filter((r): r is string => !!r),
    );

    const novos = lista.filter((c) => !conhecidos.has(c.ref));
    if (novos.length === 0) return 0;

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
    return resultado.count;
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

// Nome do arquivo do anexo. O app de cotações já monta o nome no padrão dos
// PDFs antigos da Gama ("Proposta 3011-26 Ver. 1.0 CLIENTE LTDA"); aqui só se
// acrescenta o código de verificação e se tira o que o Storage/Windows não
// aceitam. As regras de saneamento são as mesmas do buildStoragePath do
// OpportunityAttachmentService (path traversal e caractere fora do conjunto
// seguro) — quem mexer numa, olhe a outra.
export function nomeArquivoProposta(base: string, codigo: string): string {
  const limpo = base
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9 ._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  const nome = limpo.length > 0 ? limpo : 'Proposta';
  return `${nome} (${codigo}).pdf`;
}

// Uma solicitação do funil como a Fila de cotação do app precisa vê-la: o
// pedido (empresa, etapa, responsável) e os itens pedidos. Nada de orçamento —
// quem sabe o que já foi cotado é o app.
export interface SolicitacaoDaFila {
  opportunity_id: string;
  empresa: { id: string; nome: string; cnpj: string; uf: string };
  etapa: string;
  etapa_posicao: number;
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
