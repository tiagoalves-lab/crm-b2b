import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentMembership } from '../../tenancy/current-membership.decorator';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import { CorrigirContatoDto } from './dto/corrigir-contato.dto';
import { EgestorCartaoCnpjService } from './egestor-cartao-cnpj.service';
import { ListContatosQueryDto } from './dto/list-contatos-query.dto';
import { EgestorContatoCorrectionService } from './egestor-contato-correction.service';
import { EgestorContatoPromoteService } from './egestor-contato-promote.service';
import { EgestorContatoSyncService } from './egestor-contato-sync.service';
import { CompanyService } from '../../companies/company.service';
import { PolicyService } from '../../policy/policy.service';
import { EgestorInteractionLogService } from './egestor-interaction-log.service';
import { EgestorVendaSyncService } from './egestor-venda-sync.service';
import {
  descreverContato,
  descreverEmpresa,
  nomeDaLinha,
} from './egestor.types';

// Restrito a owner/admin (mesmo critério de outras ações administrativas
// do projeto, ex. ContactService#mustBeAdminOrOwner) — dispara chamadas
// pra fora (eGestor) e grava dado do workspace inteiro, não é ação de
// representante individual.
//
// Exceção deliberada: `propagarCompany` (salvar a ficha da empresa) NÃO
// usa esta lista — ver o comentário lá. É ação de quem edita cadastro, não
// de quem administra a integração.
const SYNC_ROLES = new Set(['owner', 'admin']);

// Teto de consultas à Receita (BrasilAPI) por clique no botão "Promover
// contatos" — ver comentário no endpoint. ~1s por consulta, então 25 é o
// que cabe folgado no tempo de uma requisição HTTP normal.
const MAX_CARTAO_CNPJ_POR_PROMOCAO = 25;

@Controller('integrations/egestor')
export class EgestorSyncController {
  constructor(
    private readonly sync: EgestorContatoSyncService,
    private readonly promote: EgestorContatoPromoteService,
    private readonly correction: EgestorContatoCorrectionService,
    private readonly tenantContext: TenantContextService,
    private readonly interactionLog: EgestorInteractionLogService,
    private readonly policy: PolicyService,
    private readonly companies: CompanyService,
    private readonly cartaoCnpj: EgestorCartaoCnpjService,
    private readonly vendas: EgestorVendaSyncService,
  ) {}

  // Síncrono de propósito (decisão registrada em
  // docs/roadmap.md, seção "Fatia 2") — chamado manualmente
  // (Postman/curl), sem UI ainda. `maxPages` opcional só pra teste de
  // amostra (nunca usado na carga real).
  // Limite apertado (docs/seguranca.md, decisão 5.4): esta rota varre a
  // API externa do eGestor página a página e persiste tudo. Além do custo
  // pro nosso banco, disparar isso em rajada bateria no rate limit do
  // terceiro — o limite aqui protege dos dois lados.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('sync/contatos')
  async syncContatos(
    @CurrentMembership() membership: MembershipContext,
    @Query('maxPages') maxPages?: string,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem rodar a sincronização do eGestor.',
      );
    }

    const parsedMaxPages = maxPages ? Number.parseInt(maxPages, 10) : undefined;
    const options =
      parsedMaxPages && Number.isFinite(parsedMaxPages) && parsedMaxPages > 0
        ? { maxPages: parsedMaxPages }
        : undefined;

    // Fase de rede (fetch) fica FORA da transação do Postgres de propósito
    // — ver comentário em EgestorContatoSyncService. Só a fase de escrita
    // (persist) abre transação, com timeout maior (mesmo padrão do import
    // de planilha de leads).
    const { rows, ...stats } = await this.sync.fetchConsolidated(options);

    const summary = await this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      async (tx) => {
        const resultado = await this.sync.persist(tx, membership, rows);
        await this.interactionLog.registrar(tx, membership.workspaceId, {
          origin: 'crm',
          action: 'sincronizar',
          summary: `Sincronização manual disparada — ${stats.totalMatriz} contato(s) na Matriz e ${stats.totalFilial} na Filial consultados via API (${stats.semCnpjIgnorados} sem CNPJ ignorado(s)); tabela egestor_contatos_consolidado atualizada com ${resultado.total} linha(s) (${resultado.soMatriz} só Matriz, ${resultado.soFilial} só Filial, ${resultado.ambosIguais} iguais, ${resultado.ambosDiferentes} divergentes)${resultado.orfasRemovidas > 0 ? `, ${resultado.orfasRemovidas} linha(s) órfã(s) removida(s)` : ''}${resultado.companiesDesativadas > 0 ? `, ${resultado.companiesDesativadas} Company(s) desativada(s) (não é mais cliente)` : ''}.`,
        });
        return resultado;
      },
      { timeoutMs: 120_000 },
    );

    return { ...stats, ...summary };
  }

  // Carga do histórico de vendas das duas contas (raia "Vendas histórico"
  // do roadmap) — alimenta LTV/última compra/aba Pós-venda. Mesma
  // separação fetch-fora/persist-dentro do sync de contatos, pelo mesmo
  // motivo (23 páginas de API com throttle de 1,1s não podem segurar
  // conexão do pool aberta).
  //
  // Pré-requisito: o sync de Contatos precisa ter rodado e as linhas
  // promovidas — é o espelho de contatos que diz qual `codContato` do
  // eGestor é qual empresa do CRM. Venda de cliente ainda não promovido
  // não é perdida em silêncio: volta no resumo como "órfã".
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('sync/vendas')
  async syncVendas(
    @CurrentMembership() membership: MembershipContext,
    @Query('maxPages') maxPages?: string,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem rodar a sincronização do eGestor.',
      );
    }

    const parsedMaxPages = maxPages ? Number.parseInt(maxPages, 10) : undefined;
    const options =
      parsedMaxPages && Number.isFinite(parsedMaxPages) && parsedMaxPages > 0
        ? { maxPages: parsedMaxPages }
        : undefined;

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    // Transação curta só pra saber quem são os membros — o casamento
    // vendedor do eGestor × membro do CRM acontece contra o Supabase Auth
    // (fora do Postgres), na fase de rede.
    const membroUserIds = await this.tenantContext.run(ctx, (tx) =>
      tx.membership
        .findMany({
          where: { workspaceId: membership.workspaceId },
          select: { userId: true },
        })
        .then((ms) => ms.map((m) => m.userId)),
    );

    const fetched = await this.vendas.fetch(membroUserIds, options);

    const summary = await this.tenantContext.run(
      ctx,
      async (tx) => {
        const resultado = await this.vendas.persist(
          tx,
          membership.workspaceId,
          fetched,
        );
        await this.interactionLog.registrar(tx, membership.workspaceId, {
          origin: 'crm',
          action: 'sincronizar_vendas',
          summary: `Sincronização manual de vendas disparada — ${fetched.totalMatriz} venda(s) na Matriz e ${fetched.totalFilial} na Filial consultadas via API; tabela sales_history regravada com ${resultado.gravadas} venda(s) de ${resultado.empresasComVenda} empresa(s) (${resultado.novas} nova(s), ${resultado.removidas} que não existem mais no eGestor) e ${resultado.itensGravados} item(ns) de produto/serviço em sales_history_item${resultado.orfas > 0 ? `; ${resultado.orfas} cliente(s) do eGestor ainda sem empresa correspondente no CRM tiveram as vendas ignoradas` : ''}${resultado.semVendedorVinculado > 0 ? `; ${resultado.semVendedorVinculado} venda(s) sem vendedor vinculado a membro do CRM${fetched.vendedoresSemMembro.length > 0 ? ` (${fetched.vendedoresSemMembro.join(', ')})` : ''}` : ''}${fetched.descartadas > 0 ? `; ${fetched.descartadas} linha(s) da API sem código/cliente/data descartada(s)` : ''}.`,
        });
        return resultado;
      },
      { timeoutMs: 120_000 },
    );

    return {
      totalMatriz: fetched.totalMatriz,
      totalFilial: fetched.totalFilial,
      descartadas: fetched.descartadas,
      vendedoresSemMembro: fetched.vendedoresSemMembro,
      ...summary,
    };
  }

  // Promove linhas "limpas" (so_matriz/so_filial/ambos_iguais) da tabela
  // espelho pra Company de verdade — decisões 1.11/1.13
  // (docs/roadmap.md). A promoção em si não busca nada na API do eGestor,
  // só lê/escreve no Postgres — roda inteira dentro de uma única
  // transação, sem a divisão fetch-fora/persist-dentro do endpoint acima.
  @Post('promover-contatos')
  async promoverContatos(@CurrentMembership() membership: MembershipContext) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem promover contatos do eGestor.',
      );
    }

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const resultado = await this.tenantContext.run(
      ctx,
      async (tx) => {
        const resumo = await this.promote.promoteClean(
          tx,
          membership.workspaceId,
        );
        await this.interactionLog.registrar(tx, membership.workspaceId, {
          origin: 'crm',
          action: 'promover_contatos',
          summary: `Promoção manual de contatos limpos disparada — ${resumo.promovidas} linha(s) promovida(s) pra tabela companies (${resumo.criadasNovas} Company(s) nova(s), ${resumo.vinculadasExistente} vinculada(s) a cadastro já existente), ${resumo.contatosCriados} registro(s) criado(s) na tabela contacts${resumo.fichasAtualizadas > 0 ? `, ${resumo.fichasAtualizadas} ficha(s) de empresa atualizada(s) com o cadastro do eGestor` : ''}${resumo.erros.length > 0 ? `, ${resumo.erros.length} erro(s)` : ''}.`,
        });
        return resumo;
      },
      { timeoutMs: 120_000 },
    );

    // Cartão CNPJ da Receita nas empresas criadas agora (2026-08-19, mesmo
    // motivo da fase 4 do webhook — sem isso a aba "Dados cadastrais"
    // nasce vazia). Fora da transação: é chamada de rede, uma por empresa.
    // Teto por rodada porque isto acontece DENTRO da requisição HTTP do
    // botão — promoção em massa (centenas) estouraria o tempo de resposta;
    // o que passar do teto continua sem ficha até a próxima rodada ou até
    // o script de sanitização em lote, e isso fica dito no histórico em vez
    // de sumir em silêncio.
    const paraEnriquecer = resultado.companiesCriadasIds.slice(
      0,
      MAX_CARTAO_CNPJ_POR_PROMOCAO,
    );
    let preenchidas = 0;
    for (const companyId of paraEnriquecer) {
      const r = await this.cartaoCnpj.preencherSeFaltando(
        ctx,
        membership,
        companyId,
      );
      if (r.status === 'preenchido') preenchidas += 1;
    }
    const naoEnriquecidas =
      resultado.companiesCriadasIds.length - paraEnriquecer.length;
    if (paraEnriquecer.length > 0) {
      await this.tenantContext.run(ctx, (tx) =>
        this.interactionLog.registrar(tx, membership.workspaceId, {
          origin: 'crm',
          action: 'cartao_cnpj_preenchido',
          summary: `Cartão CNPJ da Receita Federal consultado para ${paraEnriquecer.length} empresa(s) recém-criada(s) na promoção — ${preenchidas} com a aba "Dados cadastrais" preenchida (tabela companies atualizada)${naoEnriquecidas > 0 ? `; ${naoEnriquecidas} empresa(s) ficaram de fora desta rodada (teto de ${MAX_CARTAO_CNPJ_POR_PROMOCAO} consulta(s) por promoção) e seguem sem a ficha da Receita` : ''}.`,
        }),
      );
    }

    return resultado;
  }

  // Histórico legível de interações (docs/roadmap.md, "Criar log das
  // interações de requisições de API", 2026-08-13) — botão "Histórico de
  // requisições" na tela Integração eGestor. Cobre ação manual (origem
  // "crm") e processamento automático do webhook (origem "egestor_matriz"/
  // "egestor_filial"), ver EgestorInteractionLogService.
  @Get('interaction-log')
  async listarInteractionLog(
    @CurrentMembership() membership: MembershipContext,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem ver o histórico de interações do eGestor.',
      );
    }

    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.interactionLog.listar(tx, membership.workspaceId),
    );
  }

  // Relatório de auditoria (docs/roadmap.md, item 9.3) — lista a tabela
  // espelho inteira do workspace (~300 linhas no volume atual, sem
  // paginação de verdade, mesmo critério já usado em Empresas/Prospecção:
  // fetch tudo, filtra/ordena no client). Tela: "Integração eGestor" em
  // Administração.
  @Get('contatos')
  async listarContatos(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListContatosQueryDto,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem ver o relatório de integração do eGestor.',
      );
    }

    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.correction.listar(tx, membership.workspaceId, query.status),
    );
  }

  // Corrige uma divergência Matriz×Filial gravando de volta no eGestor
  // (docs/roadmap.md, item 9.6 — mesmo fluxo/tela do 9.3). 3 fases: lê e
  // valida (tx curta) → GET+PUT no eGestor (fora de tx, é a parte lenta/de
  // rede) → grava o resultado no espelho (tx curta). Mesma separação
  // fetch-fora/persist-dentro do endpoint de sync acima, pelo mesmo
  // motivo: chamada de rede não pode segurar conexão do pool ociosa.
  @Post('contatos/:id/corrigir')
  async corrigirContato(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrigirContatoDto,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem corrigir divergências no eGestor.',
      );
    }

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const row = await this.tenantContext.run(ctx, (tx) =>
      this.correction.buscarParaCorrecao(tx, membership.workspaceId, id),
    );

    const resultado = await this.correction.aplicarCorrecaoNoEgestor(
      row,
      dto.direcao,
    );

    return this.tenantContext.run(ctx, async (tx) => {
      const persistido = await this.correction.persistirCorrecao(
        tx,
        id,
        membership.workspaceId,
        dto.direcao,
        resultado,
      );
      const ficha = await this.promote.sincronizarFichaDaLinha(
        tx,
        membership.workspaceId,
        id,
      );
      const destino =
        dto.direcao === 'matriz_para_filial' ? 'Filial' : 'Matriz';
      await this.interactionLog.registrar(tx, membership.workspaceId, {
        origin: 'crm',
        action: 'corrigir',
        summary: `Correção manual disparada (${descreverEmpresa(row.cpfCnpj, nomeDaLinha(row))}) — campo(s) [${resultado.camposCorrigidos.join(', ')}] gravado(s) via PUT no eGestor ${destino} (${descreverContato(resultado.codigoEscrito, nomeDaLinha(row))}), espelhado na tabela egestor_contatos_consolidado${sufixoFicha(ficha)}.`,
      });
      return persistido;
    });
  }

  // "Consolidar" (pedido do usuário, 2026-08-11) — une os campos de lista
  // divergentes (e-mails/telefones/tags/tipo) nos DOIS lados em vez de
  // escolher um lado pra sobrescrever o outro (isso é o "Corrigir" acima).
  // Sem body: sempre consolida todo campo-lista divergente da linha, os
  // demais (escalares) ficam intocados. Mesma separação em 3 fases.
  @Post('contatos/:id/consolidar')
  async consolidarContato(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem consolidar contatos no eGestor.',
      );
    }

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const row = await this.tenantContext.run(ctx, (tx) =>
      this.correction.buscarParaCorrecao(tx, membership.workspaceId, id),
    );

    const resultado = await this.correction.aplicarConsolidacaoNoEgestor(row);

    return this.tenantContext.run(ctx, async (tx) => {
      const persistido = await this.correction.persistirConsolidacao(
        tx,
        id,
        row,
        resultado,
      );
      const ficha = await this.promote.sincronizarFichaDaLinha(
        tx,
        membership.workspaceId,
        id,
      );
      const lados = resultado.codigosEscritos
        .map((c) => (c.estabelecimento === 'matriz' ? 'Matriz' : 'Filial'))
        .join(' e ');
      await this.interactionLog.registrar(tx, membership.workspaceId, {
        origin: 'crm',
        action: 'consolidar',
        summary: `Consolidação manual disparada (${descreverEmpresa(row.cpfCnpj, nomeDaLinha(row))}) — campo(s) de lista [${resultado.camposConsolidados.join(', ')}] unidos e gravados via PUT no eGestor ${lados}, espelhado na tabela egestor_contatos_consolidado${sufixoFicha(ficha)}.`,
      });
      return persistido;
    });
  }

  // "Corrigir com SEFAZ" (pedido do usuário, 2026-08-11) — usa o cartão
  // CNPJ (Receita Federal, ver comentário de CAMPOS_SEFAZ no service)
  // como fonte em vez de Matriz/Filial. Sem body: o backend busca a
  // Receita de novo aqui (nunca confia em dado de Receita vindo do
  // client — o botão "Consultar SEFAZ" da tela é só pré-visualização) e
  // decide sozinho quais lados corrigir. Mesma separação em 3 fases.
  @Post('contatos/:id/corrigir-sefaz')
  async corrigirContatoSefaz(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem corrigir contatos no eGestor.',
      );
    }

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const row = await this.tenantContext.run(ctx, (tx) =>
      this.correction.buscarParaCorrecaoExterna(tx, membership.workspaceId, id),
    );

    const resultado = await this.correction.aplicarCorrecaoSefazNoEgestor(row);

    return this.tenantContext.run(ctx, async (tx) => {
      const persistido = await this.correction.persistirConsolidacao(
        tx,
        id,
        row,
        resultado,
      );
      const ficha = await this.promote.sincronizarFichaDaLinha(
        tx,
        membership.workspaceId,
        id,
      );
      const lados = resultado.codigosEscritos
        .map((c) => (c.estabelecimento === 'matriz' ? 'Matriz' : 'Filial'))
        .join(' e ');
      await this.interactionLog.registrar(tx, membership.workspaceId, {
        origin: 'crm',
        action: 'corrigir_sefaz',
        summary: `Correção manual com a Receita Federal disparada (${descreverEmpresa(row.cpfCnpj, nomeDaLinha(row))}) — campo(s) [${resultado.camposConsolidados.join(', ')}] gravado(s) via PUT no eGestor ${lados}, espelhado na tabela egestor_contatos_consolidado${sufixoFicha(ficha)}.`,
      });
      return persistido;
    });
  }

  // "Corrigir com CRM" (pedido do usuário, 2026-08-13, na esteira da
  // sanitização em lote via cartão CNPJ — ver
  // scripts/sanitizar-cadastros-cnpj.ts) — mesmo mecanismo de "Corrigir
  // com SEFAZ" acima, mas a fonte é o cadastro que já está gravado em
  // `companies` (mesmo CNPJ) em vez de consultar a Receita de novo. Sem
  // body: busca a Company dentro da mesma tx de `buscarParaCorrecaoExterna`
  // (fase 1), decide sozinho quais lados corrigir (fase 2, fora de tx).
  // buscarParaCorrecaoExterna (não buscarParaCorrecao) de propósito —
  // aceita status ambos_iguais também, pro caso de Matriz/Filial
  // concordarem entre si mas divergirem do CRM (2026-08-14).
  @Post('contatos/:id/corrigir-crm')
  async corrigirContatoCrm(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem corrigir contatos no eGestor.',
      );
    }

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const { row, crm } = await this.tenantContext.run(ctx, async (tx) => {
      const row = await this.correction.buscarParaCorrecaoExterna(
        tx,
        membership.workspaceId,
        id,
      );
      const crm = await this.correction.buscarDadosCrm(
        tx,
        membership.workspaceId,
        row.cpfCnpj,
      );
      return { row, crm };
    });

    if (!crm) {
      throw new BadRequestException(
        'Nenhuma empresa cadastrada no CRM com este CNPJ — cadastre em Empresas antes de usar esta opção.',
      );
    }

    const resultado = await this.correction.aplicarCorrecaoCrmNoEgestor(
      row,
      crm,
    );

    return this.tenantContext.run(ctx, async (tx) => {
      const persistido = await this.correction.persistirConsolidacao(
        tx,
        id,
        row,
        resultado,
      );
      const lados = resultado.codigosEscritos
        .map((c) => (c.estabelecimento === 'matriz' ? 'Matriz' : 'Filial'))
        .join(' e ');
      // Sem sincronizar a ficha aqui: nesta ação o CRM é a ORIGEM — o
      // valor que foi pro eGestor já é o que está na ficha.
      await this.interactionLog.registrar(tx, membership.workspaceId, {
        origin: 'crm',
        action: 'corrigir_crm',
        summary: `Correção manual com o CRM disparada (${descreverEmpresa(row.cpfCnpj, nomeDaLinha(row))}) — campo(s) [${resultado.camposConsolidados.join(', ')}] gravado(s) via PUT no eGestor ${lados}, espelhado na tabela egestor_contatos_consolidado.`,
      });
      return persistido;
    });
  }

  // Propagação CRM → eGestor disparada ao SALVAR A FICHA DA EMPRESA
  // (decisão do usuário, 2026-08-14: "eu atualizo no CRM e isso deve
  // propagar pro eGestor"). Mesma escrita de "Corrigir com CRM", com duas
  // diferenças de contrato, as duas por causa de quem chama:
  //  - entrada é o `companyId` (a ficha não conhece o id do espelho);
  //  - **nunca lança** por "não havia o que propagar". Salvar uma empresa
  //    sem vínculo com o eGestor, ou cujos dados já batem, é situação
  //    normal — e o save no CRM já aconteceu antes desta chamada, então
  //    derrubar a ação com erro daria a impressão falsa de que não salvou.
  //    Só falha de rede/PUT continua propagando exceção.
  @Post('companies/:companyId/propagar')
  async propagarCompany(
    @CurrentMembership() membership: MembershipContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    // Permissão por CAPACIDADE, não por papel (decisão do usuário,
    // 2026-08-14: "se o usuário tiver permissão, as alterações devem ser
    // propagadas de forma global"). Quem pode editar Dados cadastrais
    // propaga; quem só tem permissão de Contatos edita o contato e não
    // dispara nada no eGestor — os dois já são módulos separados na
    // matriz. Diferente das outras rotas deste controller (SYNC_ROLES):
    // aquelas administram a integração inteira, esta é o eco de um save
    // que a pessoa já tinha direito de fazer.
    if (!this.policy.canModule(membership, 'empresas_cadastro', 'editar')) {
      throw new ForbiddenException(
        'Sem permissão para editar dados cadastrais desta empresa.',
      );
    }

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const alvo = await this.tenantContext.run(ctx, async (tx) => {
      // Ownership da Company ANTES de qualquer coisa (404 se a pessoa não
      // enxerga): sem isso, ter a capacidade "editar cadastro" bastaria
      // pra disparar escrita no ERP a partir da empresa de outro
      // representante — a capacidade diz o QUE a pessoa pode fazer, o
      // escopo (RLS/ownership) diz EM QUAIS registros.
      await this.companies.findOne(tx, membership, companyId);
      return this.correction.buscarParaPropagacao(
        tx,
        membership.workspaceId,
        companyId,
      );
    });

    if (!alvo.ok) {
      return { propagado: false, motivo: alvo.motivo };
    }
    if (!alvo.crm) {
      return { propagado: false, motivo: 'Empresa não encontrada no CRM.' };
    }

    const { row, crm } = alvo;

    let resultado;
    try {
      resultado = await this.correction.aplicarCorrecaoCrmNoEgestor(row, crm);
    } catch (error) {
      // aplicarValoresDeFonteNoEgestor lança BadRequest quando nenhum
      // campo precisava de PUT — aqui isso significa "já estava tudo
      // igual", que é o desfecho mais comum ao salvar a ficha sem mexer
      // em campo espelhado. Qualquer outro erro (rede, 4xx/5xx do
      // eGestor) continua subindo.
      if (error instanceof BadRequestException) {
        return { propagado: false, motivo: 'Nada a propagar — já está igual.' };
      }
      throw error;
    }

    return this.tenantContext.run(ctx, async (tx) => {
      await this.correction.persistirConsolidacao(tx, row.id, row, resultado);
      const lados = resultado.codigosEscritos
        .map((c) => (c.estabelecimento === 'matriz' ? 'Matriz' : 'Filial'))
        .join(' e ');
      await this.interactionLog.registrar(tx, membership.workspaceId, {
        origin: 'crm',
        action: 'propagar_ficha',
        summary: `Cadastro salvo na ficha da empresa (${descreverEmpresa(row.cpfCnpj, nomeDaLinha(row))}) — campo(s) [${resultado.camposConsolidados.join(', ')}] propagado(s) via PUT no eGestor ${lados}, espelhado na tabela egestor_contatos_consolidado.`,
      });
      return {
        propagado: true,
        campos: resultado.camposConsolidados,
        lados: resultado.codigosEscritos.map((c) => c.estabelecimento),
      };
    });
  }

  // "Completar Matriz ⇄ Filial" (docs/roadmap.md, item 9.9) — pro caso
  // so_matriz/so_filial: cria o contato que falta na conta ausente,
  // usando os dados do lado que já existe. Sem escolha de direção no
  // body (diferente de "Corrigir") — a direção é a própria situação da
  // linha (so_matriz só pode completar a Filial, e vice-versa). Mesma
  // separação em 3 fases do endpoint de corrigir acima.
  @Post('contatos/:id/completar')
  async completarContato(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!SYNC_ROLES.has(membership.role)) {
      throw new ForbiddenException(
        'Só owner/admin podem completar Matriz/Filial no eGestor.',
      );
    }

    const ctx = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    const row = await this.tenantContext.run(ctx, (tx) =>
      this.correction.buscarParaCompletar(tx, membership.workspaceId, id),
    );

    const resultado = await this.correction.completarNoEgestor(row);

    return this.tenantContext.run(ctx, async (tx) => {
      // Código NOVO (criado agora), não um dos já existentes na linha.
      const persistido = await this.correction.persistirCompletar(
        tx,
        id,
        row,
        resultado,
      );
      const ficha = await this.promote.sincronizarFichaDaLinha(
        tx,
        membership.workspaceId,
        id,
      );
      const destino =
        resultado.estabelecimentoEscrito === 'filial' ? 'Filial' : 'Matriz';
      await this.interactionLog.registrar(tx, membership.workspaceId, {
        origin: 'crm',
        action: 'completar',
        summary: `"Completar Matriz ⇄ Filial" manual disparado (${descreverEmpresa(row.cpfCnpj, nomeDaLinha(row))}) — contato novo criado via POST no eGestor ${destino} (${descreverContato(resultado.codigoNovo, nomeDaLinha(row))}), espelhado na tabela egestor_contatos_consolidado${sufixoFicha(ficha)}.`,
      });
      return persistido;
    });
  }
}

// Terceira base das ações da tela (CRM), no texto do histórico — some
// quando a ficha já batia com o eGestor, pra não encher a linha de
// "nenhum campo alterado".
function sufixoFicha(campos: string[]): string {
  return campos.length > 0
    ? ` e aplicado na ficha da empresa no CRM (${campos.join(', ')})`
    : '';
}
