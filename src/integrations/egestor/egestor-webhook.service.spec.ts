import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantContextService } from '../../tenancy/tenant-context.service';
import type { EgestorCartaoCnpjService } from './egestor-cartao-cnpj.service';
import type { EgestorInteractionLogService } from './egestor-interaction-log.service';
import type { EgestorWebhookEchoService } from './egestor-webhook-echo.service';
import type {
  EgestorWebhookProcessingService,
  PlanoEventoContato,
} from './egestor-webhook-processing.service';
import { EgestorWebhookService } from './egestor-webhook.service';
import type { EgestorWebhookPayloadDto } from './dto/egestor-webhook-payload.dto';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function fakePayload(
  overrides: Partial<EgestorWebhookPayloadDto> = {},
): EgestorWebhookPayloadDto {
  return {
    action: 'updated',
    codigo: 1157,
    date: '2026-08-12 15:10:13',
    module: 'contatos',
    securityToken: 'token-matriz-valido',
    ...overrides,
  };
}

const planoAvaliarSimples: PlanoEventoContato = {
  tipo: 'avaliar',
  cnpj: '11111111000100',
  row: {
    cpfCnpj: '11111111000100',
    status: 'so_matriz',
    codigoMatriz: '1',
    codigoFilial: null,
    nomeMatriz: 'X',
    nomeFilial: null,
    dadosMatriz: { codigo: 1, tipo: ['cliente'] },
    dadosFilial: null,
    camposDiferentes: [],
  },
  mirrorExistente: null,
};

// Fake em memória de `egestorWebhookEvent` — compartilhado entre as
// chamadas de `tenantContext.run` dentro de um `handleEvent` (fase 1 cria/
// acha, fase 5 acha de novo e atualiza).
function criarFakeTx() {
  const linhas: Array<Record<string, unknown>> = [];
  let seq = 0;
  return {
    linhas,
    tx: {
      // Fake do advisory lock por contato (regra 5, 2026-08-13) — a
      // implementação real chama `tx.$executeRaw` via tagged template
      // (`pg_advisory_xact_lock`), aqui só confirma que foi chamado.
      $executeRaw: jest.fn().mockResolvedValue(1),
      // Só o ramo do eco consulta o espelho direto (pra pôr a razão social
      // no histórico, 2026-08-17) — nos demais o nome vem do contato
      // fresco/do plano. Fake devolve uma linha com nome pra travar o
      // formato "código X - NOME, Matriz" no teste do eco.
      egestorContatoConsolidado: {
        findFirst: jest.fn().mockResolvedValue({
          nomeMatriz: 'EMPRESA ECO LTDA',
          nomeFilial: null,
        }),
      },
      egestorWebhookEvent: {
        findFirst: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            return (
              linhas.find(
                (l) =>
                  l.workspaceId === where.workspaceId &&
                  l.estabelecimento === where.estabelecimento &&
                  l.module === where.module &&
                  l.codigoExterno === where.codigoExterno &&
                  l.action === where.action &&
                  (l.dataEgestor as Date).getTime() ===
                    (where.dataEgestor as Date).getTime(),
              ) ?? null
            );
          },
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          seq += 1;
          const nova = {
            id: `evt-${seq}`,
            processedAt: null,
            processResult: null,
            ...data,
          };
          linhas.push(nova);
          return nova;
        }),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const idx = linhas.findIndex((l) => l.id === where.id);
            linhas[idx] = { ...linhas[idx], ...data };
            return linhas[idx];
          },
        ),
      },
    },
  };
}

function criarService(overrides: {
  config?: Record<string, string | undefined>;
  echoConsumirSeEco?: jest.Mock;
  processingBuscar?: jest.Mock;
  processingPlanejar?: jest.Mock;
  processingCorrigir?: jest.Mock;
  processingCompletar?: jest.Mock;
  processingFinalizar?: jest.Mock;
  cartaoPreencher?: jest.Mock;
  fakeTxHolder?: ReturnType<typeof criarFakeTx>;
}) {
  const fakeTxHolder = overrides.fakeTxHolder ?? criarFakeTx();

  const prisma = {
    workspace: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ws-1' }),
    },
  } as unknown as PrismaService;

  const tenantContext = {
    run: jest.fn((_ctx: unknown, fn: (tx: unknown) => unknown) =>
      fn(fakeTxHolder.tx),
    ),
  } as unknown as TenantContextService;

  const echo = {
    consumirSeEco:
      overrides.echoConsumirSeEco ?? jest.fn().mockResolvedValue(false),
    registrar: jest.fn(),
  } as unknown as EgestorWebhookEchoService;

  const processing = {
    buscarContatoFresco:
      overrides.processingBuscar ??
      jest.fn().mockResolvedValue({ codigo: 1157, tipo: ['cliente'] }),
    planejarEvento:
      overrides.processingPlanejar ??
      jest.fn().mockResolvedValue(planoAvaliarSimples),
    aplicarCorrecaoAutomatica: overrides.processingCorrigir ?? jest.fn(),
    aplicarCompletarAutomatico: overrides.processingCompletar ?? jest.fn(),
    finalizarEvento:
      overrides.processingFinalizar ??
      jest.fn().mockResolvedValue('atualizada'),
  } as unknown as EgestorWebhookProcessingService;

  const interactionLog = {
    registrar: jest.fn(),
  } as unknown as EgestorInteractionLogService;

  // Fase 4 (Cartão CNPJ na empresa promovida, 2026-08-19) — por padrão
  // devolve "já tinha", que é o caminho silencioso: não escreve no
  // histórico e não interfere nos testes das fases 1-3.
  const preencherSeFaltando =
    overrides.cartaoPreencher ??
    jest.fn().mockResolvedValue({ status: 'ja_tinha' });
  const cartaoCnpj = {
    preencherSeFaltando,
  } as unknown as EgestorCartaoCnpjService;

  const service = new EgestorWebhookService(
    fakeConfig(overrides.config ?? {}),
    prisma,
    tenantContext,
    echo,
    processing,
    interactionLog,
    cartaoCnpj,
  );

  return {
    service,
    fakeTxHolder,
    echo,
    processing,
    tenantContext,
    interactionLog,
    cartaoCnpj: preencherSeFaltando,
  };
}

describe('EgestorWebhookService', () => {
  describe('assertValidToken', () => {
    it('passa quando o token bate com o configurado pra Matriz', () => {
      const { service } = criarService({
        config: { egestorWebhookSecurityTokenMatriz: 'token-matriz' },
      });

      expect(() =>
        service.assertValidToken('matriz', 'token-matriz'),
      ).not.toThrow();
    });

    it('usa o token da Filial quando o estabelecimento é "filial", não o da Matriz', () => {
      const { service } = criarService({
        config: {
          egestorWebhookSecurityTokenMatriz: 'token-matriz',
          egestorWebhookSecurityTokenFilial: 'token-filial',
        },
      });

      expect(() =>
        service.assertValidToken('filial', 'token-filial'),
      ).not.toThrow();
      expect(() => service.assertValidToken('filial', 'token-matriz')).toThrow(
        UnauthorizedException,
      );
    });

    it('lança 401 quando o token não bate', () => {
      const { service } = criarService({
        config: { egestorWebhookSecurityTokenMatriz: 'token-certo' },
      });

      expect(() => service.assertValidToken('matriz', 'token-errado')).toThrow(
        UnauthorizedException,
      );
    });

    it('lança 401 quando o token tem tamanho diferente (não estoura no timingSafeEqual)', () => {
      const { service } = criarService({
        config: { egestorWebhookSecurityTokenMatriz: 'token-longo-certo' },
      });

      expect(() => service.assertValidToken('matriz', 'curto')).toThrow(
        UnauthorizedException,
      );
    });

    it('lança 401 quando a env var não está configurada pra aquele estabelecimento', () => {
      const { service } = criarService({});

      expect(() =>
        service.assertValidToken('matriz', 'qualquer-coisa'),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('handleEvent', () => {
    it('evento novo, sem divergência: loga, busca fresco, planeja, finaliza sem corrigir nada no eGestor', async () => {
      const { service, fakeTxHolder, processing, interactionLog } =
        criarService({});

      const resultado = await service.handleEvent('matriz', fakePayload());

      expect(resultado).toEqual({ processResult: 'atualizada' });
      // Histórico legível (EgestorInteractionLog) registrado com origem
      // "egestor_matriz" — este evento veio da Matriz.
      expect(interactionLog.registrar).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        expect.objectContaining({
          origin: 'egestor_matriz',
          action: 'webhook_processado',
          // Razão social ao lado do código (pedido do usuário, 2026-08-17).
          // Aqui o contato fresco do eGestor não trouxe `nome`, então cai
          // pro nome do espelho — o histórico nunca fica só com o número.
          summary: expect.stringContaining('código 1157 - X, Matriz'),
        }),
      );
      expect(processing.buscarContatoFresco).toHaveBeenCalledWith(
        'matriz',
        'updated',
        '1157',
      );
      expect(processing.planejarEvento).toHaveBeenCalled();
      expect(processing.aplicarCorrecaoAutomatica).not.toHaveBeenCalled();
      expect(processing.finalizarEvento).toHaveBeenCalledWith(
        fakeTxHolder.tx,
        'ws-1',
        expect.objectContaining({ role: 'owner' }),
        planoAvaliarSimples,
        undefined,
        undefined,
      );
      expect(fakeTxHolder.linhas[0].processedAt).not.toBeNull();
      expect(fakeTxHolder.linhas[0].processResult).toBe('atualizada');
      expect(fakeTxHolder.linhas[0].rawPayload).not.toHaveProperty(
        'securityToken',
      );
      // Lock por contato (regra 5, 2026-08-13) adquirido antes de
      // decidir/persistir — mesmo sem divergência, roda pra qualquer
      // evento do módulo "contatos".
      expect(fakeTxHolder.tx.$executeRaw).toHaveBeenCalled();
    });

    it('plano pede correção automática: aplica no eGestor, registra o eco, e passa o resultado pro finalizarEvento', async () => {
      const planoCorrigir: PlanoEventoContato = {
        tipo: 'corrigir_divergencia',
        cnpj: '59334901000162',
        row: {
          cpfCnpj: '59334901000162',
          status: 'ambos_diferentes',
          codigoMatriz: '334',
          codigoFilial: '341',
          nomeMatriz: 'Magali',
          nomeFilial: 'Magali',
          dadosMatriz: { codigo: 334, tipo: ['fornecedor'] },
          dadosFilial: { codigo: 341, tipo: ['cliente', 'fornecedor'] },
          camposDiferentes: ['tipo'],
        },
        mirrorExistente: {
          id: 'mirror-magali',
          cpfCnpj: '59334901000162',
          companyId: 'company-magali',
        } as never,
        direcao: 'matriz_para_filial',
      };
      const resultadoCorrecao = {
        camposCorrigidos: ['tipo'],
        dadosDestinoAtualizados: { codigo: 341, tipo: ['fornecedor'] },
        estabelecimentoEscrito: 'filial' as const,
        codigoEscrito: '341',
      };
      const processingPlanejar = jest.fn().mockResolvedValue(planoCorrigir);
      const processingCorrigir = jest.fn().mockResolvedValue(resultadoCorrecao);
      const processingFinalizar = jest
        .fn()
        .mockResolvedValue('desativada_nao_e_mais_cliente');
      const { service, echo, processing } = criarService({
        processingPlanejar,
        processingCorrigir,
        processingFinalizar,
      });

      const resultado = await service.handleEvent(
        'matriz',
        fakePayload({ codigo: 334 }),
      );

      // Direção repassada como veio do plano (planejarEvento decide, não
      // o handler) — regra recalibrada 2026-08-13.
      expect(processing.aplicarCorrecaoAutomatica).toHaveBeenCalledWith(
        planoCorrigir.row,
        'matriz_para_filial',
      );
      // Eco registrado ANTES/junto de finalizar, com o (estabelecimento,
      // código) que a correção automática realmente escreveu.
      expect(echo.registrar).toHaveBeenCalledWith(expect.anything(), 'ws-1', [
        { estabelecimento: 'filial', codigo: '341' },
      ]);
      expect(processing.finalizarEvento).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        expect.anything(),
        planoCorrigir,
        resultadoCorrecao,
        undefined,
      );
      expect(resultado).toEqual({
        processResult: 'desativada_nao_e_mais_cliente',
      });
    });

    it('plano pede completar o lado faltante (regra 6, 2026-08-13): cria no eGestor, registra o eco com o código NOVO, e passa o resultado pro finalizarEvento', async () => {
      const planoCompletar: PlanoEventoContato = {
        tipo: 'completar_lado_faltante',
        cnpj: '22222222000100',
        row: {
          cpfCnpj: '22222222000100',
          status: 'so_matriz',
          codigoMatriz: '1',
          codigoFilial: null,
          nomeMatriz: 'X',
          nomeFilial: null,
          dadosMatriz: { codigo: 1, tipo: ['cliente'] },
          dadosFilial: null,
          camposDiferentes: [],
        },
        mirrorExistente: null,
      };
      const resultadoCompletar = {
        codigoNovo: '999',
        dadosNovo: { codigo: 999, tipo: ['cliente'], nome: 'X' },
        estabelecimentoEscrito: 'filial' as const,
      };
      const processingPlanejar = jest.fn().mockResolvedValue(planoCompletar);
      const processingCompletar = jest
        .fn()
        .mockResolvedValue(resultadoCompletar);
      const processingFinalizar = jest
        .fn()
        .mockResolvedValue('lado_faltante_completado_e_atualizada');
      const { service, echo, processing } = criarService({
        processingPlanejar,
        processingCompletar,
        processingFinalizar,
      });

      const resultado = await service.handleEvent('matriz', fakePayload());

      expect(processing.aplicarCompletarAutomatico).toHaveBeenCalledWith(
        planoCompletar.row,
      );
      // Eco registrado com o código NOVO (criado agora), não um dos já
      // existentes na linha.
      expect(echo.registrar).toHaveBeenCalledWith(expect.anything(), 'ws-1', [
        { estabelecimento: 'filial', codigo: '999' },
      ]);
      expect(processing.finalizarEvento).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        expect.anything(),
        planoCompletar,
        undefined,
        resultadoCompletar,
      );
      expect(resultado).toEqual({
        processResult: 'lado_faltante_completado_e_atualizada',
      });
    });

    it('módulo não suportado (não é "contatos"): marca processado sem chamar planejamento/processamento', async () => {
      const { service, fakeTxHolder, processing } = criarService({});

      const resultado = await service.handleEvent(
        'matriz',
        fakePayload({ module: 'vendas' }),
      );

      expect(resultado).toEqual({ processResult: 'modulo_nao_suportado' });
      expect(processing.buscarContatoFresco).not.toHaveBeenCalled();
      expect(processing.planejarEvento).not.toHaveBeenCalled();
      expect(fakeTxHolder.linhas[0].processedAt).not.toBeNull();
    });

    it('eco (escrita do próprio CRM): marca processado como eco, sem chamar planejamento/processamento', async () => {
      const echoConsumirSeEco = jest.fn().mockResolvedValue(true);
      const { service, fakeTxHolder, processing, interactionLog } =
        criarService({
          echoConsumirSeEco,
        });

      const resultado = await service.handleEvent('filial', fakePayload());

      expect(resultado).toEqual({ processResult: 'eco_ignorado' });
      expect(processing.buscarContatoFresco).not.toHaveBeenCalled();
      expect(processing.planejarEvento).not.toHaveBeenCalled();
      expect(fakeTxHolder.linhas[0].processResult).toBe('eco_ignorado');
      expect(interactionLog.registrar).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        expect.objectContaining({
          origin: 'egestor_filial',
          action: 'webhook_eco_ignorado',
          // Razão social ao lado do código (pedido do usuário, 2026-08-17):
          // o número sozinho não dizia de qual empresa era a linha, e era
          // preciso abrir o eGestor pra descobrir.
          summary: expect.stringContaining(
            'código 1157 - EMPRESA ECO LTDA, Filial',
          ),
        }),
      );
    });

    // O nome que o eGestor acabou de devolver ganha do espelho: é o mais
    // atual, e numa edição de razão social o espelho ainda tem o antigo.
    it('histórico usa a razão social do contato fresco quando o eGestor devolve nome', async () => {
      const { service, interactionLog } = criarService({
        processingBuscar: jest.fn().mockResolvedValue({
          codigo: 1157,
          nome: 'EMPRESA RECÉM-RENOMEADA LTDA',
          tipo: ['cliente'],
        }),
      });

      await service.handleEvent('matriz', fakePayload());

      expect(interactionLog.registrar).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        expect.objectContaining({
          summary: expect.stringContaining(
            'código 1157 - EMPRESA RECÉM-RENOMEADA LTDA, Matriz',
          ),
        }),
      );
    });

    it('módulo não suportado: NÃO registra no histórico legível (fora do escopo hoje)', async () => {
      const { service, interactionLog } = criarService({});

      await service.handleEvent('matriz', fakePayload({ module: 'vendas' }));

      expect(interactionLog.registrar).not.toHaveBeenCalled();
    });

    it('evento já totalmente processado (retry do eGestor): devolve o resultado salvo, sem reprocessar', async () => {
      const fakeTxHolder = criarFakeTx();
      const { service, processing } = criarService({ fakeTxHolder });

      await service.handleEvent('matriz', fakePayload());
      (processing.buscarContatoFresco as jest.Mock).mockClear();
      (processing.planejarEvento as jest.Mock).mockClear();

      const resultado = await service.handleEvent('matriz', fakePayload());

      expect(resultado).toEqual({ processResult: 'atualizada' });
      expect(processing.buscarContatoFresco).not.toHaveBeenCalled();
      expect(processing.planejarEvento).not.toHaveBeenCalled();
      expect(fakeTxHolder.linhas).toHaveLength(1); // não duplicou a linha
    });

    it('evento já logado mas NÃO processado (falhou antes): reprocessa em vez de pular', async () => {
      const fakeTxHolder = criarFakeTx();
      fakeTxHolder.linhas.push({
        id: 'evt-existente',
        workspaceId: 'ws-1',
        estabelecimento: 'matriz',
        module: 'contatos',
        action: 'updated',
        codigoExterno: '1157',
        dataEgestor: new Date('2026-08-12T15:10:13'),
        processedAt: null,
        processResult: null,
      });
      const { service, processing } = criarService({ fakeTxHolder });

      const resultado = await service.handleEvent('matriz', fakePayload());

      expect(resultado).toEqual({ processResult: 'atualizada' });
      expect(processing.finalizarEvento).toHaveBeenCalled();
      expect(fakeTxHolder.linhas).toHaveLength(1); // reusa a linha, não cria outra
      expect(fakeTxHolder.linhas[0].processedAt).not.toBeNull();
    });

    it('action=deleted: passa contatoFresco null pro planejamento (não busca na API)', async () => {
      const processingBuscar = jest.fn().mockResolvedValue(null);
      const processingPlanejar = jest
        .fn()
        .mockResolvedValue(planoAvaliarSimples);
      const { service, processing } = criarService({
        processingBuscar,
        processingPlanejar,
      });

      await service.handleEvent('filial', fakePayload({ action: 'deleted' }));

      expect(processing.buscarContatoFresco).toHaveBeenCalledWith(
        'filial',
        'deleted',
        '1157',
      );
      expect(processing.planejarEvento).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        'filial',
        'deleted',
        '1157',
        null,
      );
    });

    it('propaga erro do planejamento/finalização (não engole) — é o que faz o eGestor tentar de novo', async () => {
      const processingFinalizar = jest
        .fn()
        .mockRejectedValue(new Error('falha ao promover'));
      const { service, fakeTxHolder } = criarService({ processingFinalizar });

      await expect(
        service.handleEvent('matriz', fakePayload()),
      ).rejects.toThrow('falha ao promover');

      // A linha de log já existe (fase 1 não falhou), mas continua sem
      // processedAt — próxima tentativa do eGestor vai reprocessar.
      expect(fakeTxHolder.linhas).toHaveLength(1);
      expect(fakeTxHolder.linhas[0].processedAt).toBeNull();
    });

    it('propaga erro da correção automática (rede) — não registra eco nem finaliza', async () => {
      const planoCorrigir: PlanoEventoContato = {
        tipo: 'corrigir_divergencia',
        cnpj: '1',
        row: {
          cpfCnpj: '1',
          status: 'ambos_diferentes',
          codigoMatriz: '1',
          codigoFilial: '2',
          nomeMatriz: null,
          nomeFilial: null,
          dadosMatriz: { codigo: 1, tipo: ['cliente'] },
          dadosFilial: { codigo: 2, tipo: ['fornecedor'] },
          camposDiferentes: ['tipo'],
        },
        mirrorExistente: null,
        direcao: 'matriz_para_filial',
      };
      const processingPlanejar = jest.fn().mockResolvedValue(planoCorrigir);
      const processingCorrigir = jest
        .fn()
        .mockRejectedValue(new Error('eGestor fora do ar'));
      const { service, echo, processing } = criarService({
        processingPlanejar,
        processingCorrigir,
      });

      await expect(
        service.handleEvent('matriz', fakePayload()),
      ).rejects.toThrow('eGestor fora do ar');

      expect(echo.registrar).not.toHaveBeenCalled();
      expect(processing.finalizarEvento).not.toHaveBeenCalled();
    });
  });

  // Fase 4 (2026-08-19) — empresa que entra pelo eGestor nascia com a aba
  // "Dados cadastrais" vazia: o ERP não tem situação cadastral/CNAE/porte/
  // natureza jurídica, e nenhum caminho automático consultava a Receita.
  describe('handleEvent — Cartão CNPJ da Receita (fase 4)', () => {
    function comEspelhoPromovido(companyId: string | null) {
      const fakeTxHolder = criarFakeTx();
      fakeTxHolder.tx.egestorContatoConsolidado.findFirst = jest
        .fn()
        .mockResolvedValue({
          companyId,
          nomeMatriz: 'EMPRESA NOVA LTDA',
          nomeFilial: null,
        });
      return fakeTxHolder;
    }

    it('busca o Cartão CNPJ da empresa recém-criada e registra no histórico', async () => {
      const cartaoPreencher = jest.fn().mockResolvedValue({
        status: 'preenchido',
        camposAtualizados: ['razaoSocial'],
        emailsFonesConflito: false,
      });
      const { service, interactionLog } = criarService({
        processingFinalizar: jest.fn().mockResolvedValue('company_criada'),
        processingBuscar: jest
          .fn()
          .mockResolvedValue({ codigo: 1157, cpfcnpj: '11.111.111/0001-00' }),
        cartaoPreencher,
        fakeTxHolder: comEspelhoPromovido('company-1'),
      });

      await service.handleEvent('matriz', fakePayload());

      expect(cartaoPreencher).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'company-1',
      );
      const resumos = (interactionLog.registrar as jest.Mock).mock.calls.map(
        (c) => (c[2] as { summary: string }).summary,
      );
      expect(
        resumos.some((s) => s.includes('Cartão CNPJ da Receita Federal')),
      ).toBe(true);
    });

    it('não busca nada quando o evento não resultou em Company (contato não é cliente)', async () => {
      const cartaoPreencher = jest.fn();
      const { service } = criarService({
        processingFinalizar: jest
          .fn()
          .mockResolvedValue('nao_e_cliente_nunca_rastreado'),
        cartaoPreencher,
        fakeTxHolder: comEspelhoPromovido('company-1'),
      });

      await service.handleEvent('matriz', fakePayload());

      expect(cartaoPreencher).not.toHaveBeenCalled();
    });

    it('não escreve no histórico quando a empresa já tinha a ficha da Receita', async () => {
      const { service, interactionLog } = criarService({
        processingFinalizar: jest.fn().mockResolvedValue('company_criada'),
        processingBuscar: jest
          .fn()
          .mockResolvedValue({ codigo: 1157, cpfcnpj: '11111111000100' }),
        cartaoPreencher: jest.fn().mockResolvedValue({ status: 'ja_tinha' }),
        fakeTxHolder: comEspelhoPromovido('company-1'),
      });

      await service.handleEvent('matriz', fakePayload());

      const resumos = (interactionLog.registrar as jest.Mock).mock.calls.map(
        (c) => (c[2] as { summary: string }).summary,
      );
      expect(
        resumos.some((s) => s.includes('Cartão CNPJ da Receita Federal')),
      ).toBe(false);
    });

    // O cadastro do eGestor já entrou nesse ponto; Receita fora do ar não
    // pode virar 500 e fazer o eGestor reenviar o evento por dias.
    it('não derruba o webhook quando o enriquecimento explode', async () => {
      const { service } = criarService({
        processingFinalizar: jest.fn().mockResolvedValue('company_criada'),
        processingBuscar: jest
          .fn()
          .mockResolvedValue({ codigo: 1157, cpfcnpj: '11111111000100' }),
        cartaoPreencher: jest
          .fn()
          .mockRejectedValue(new Error('BrasilAPI fora do ar')),
        fakeTxHolder: comEspelhoPromovido('company-1'),
      });

      await expect(
        service.handleEvent('matriz', fakePayload()),
      ).resolves.toEqual({ processResult: 'company_criada' });
    });
  });
});
