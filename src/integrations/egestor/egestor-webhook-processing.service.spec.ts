import type { EgestorAuthService } from './egestor-auth.service';
import type { EgestorContatoCorrectionService } from './egestor-contato-correction.service';
import type { EgestorContatoPromoteService } from './egestor-contato-promote.service';
import type { EgestorContatoSyncService } from './egestor-contato-sync.service';
import type { EgestorHttpService } from './egestor-http.service';
import { EgestorWebhookProcessingService } from './egestor-webhook-processing.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';

const membership: MembershipContext = {
  id: 'membership-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  role: 'owner',
  status: 'active',
};

function criarService(overrides: {
  authGetAccessToken?: jest.Mock;
  httpGetOne?: jest.Mock;
  syncPersistirLinhaCalculada?: jest.Mock;
  syncReconciliarContatoUnico?: jest.Mock;
  promoverLinha?: jest.Mock;
  correctionAplicar?: jest.Mock;
  correctionCompletar?: jest.Mock;
}) {
  const auth = {
    getAccessToken:
      overrides.authGetAccessToken ?? jest.fn().mockResolvedValue('token-x'),
  } as unknown as EgestorAuthService;

  const http = {
    getOne: overrides.httpGetOne ?? jest.fn(),
  } as unknown as EgestorHttpService;

  // computarContatoUnico é lógica pura já testada em
  // egestor-contato-sync.service.spec.ts — reusa a implementação real
  // aqui em vez de mockar, só os métodos com efeito colateral são mocks.
  const { EgestorContatoSyncService: RealSync } = jest.requireActual(
    './egestor-contato-sync.service',
  );
  const realSyncInstance = new RealSync({}, {}, {});

  const sync = {
    computarContatoUnico:
      realSyncInstance.computarContatoUnico.bind(realSyncInstance),
    persistirLinhaCalculada:
      overrides.syncPersistirLinhaCalculada ??
      jest.fn().mockResolvedValue(undefined),
    reconciliarContatoUnico:
      overrides.syncReconciliarContatoUnico ??
      jest.fn().mockResolvedValue({ desativouCompany: false }),
  } as unknown as EgestorContatoSyncService;

  const promote = {
    promoverLinha:
      overrides.promoverLinha ??
      jest.fn().mockImplementation(async (_tx, _wsId, _row, summary) => {
        summary.criadasNovas += 1;
      }),
  } as unknown as EgestorContatoPromoteService;

  const correction = {
    aplicarCorrecaoNoEgestor:
      overrides.correctionAplicar ??
      jest.fn().mockResolvedValue({
        camposCorrigidos: ['tipo'],
        dadosDestinoAtualizados: {
          codigo: 341,
          cpfcnpj: '59334901000162',
          tipo: ['fornecedor'],
        },
        estabelecimentoEscrito: 'filial',
        codigoEscrito: '341',
      }),
    completarNoEgestor:
      overrides.correctionCompletar ??
      jest.fn().mockResolvedValue({
        codigoNovo: '999',
        dadosNovo: {
          codigo: 999,
          cpfcnpj: '22222222000100',
          nome: 'X',
          tipo: ['cliente'],
        },
        estabelecimentoEscrito: 'filial',
      }),
  } as unknown as EgestorContatoCorrectionService;

  const service = new EgestorWebhookProcessingService(
    auth,
    http,
    sync,
    promote,
    correction,
  );
  return { service, auth, http, sync, promote, correction };
}

function fakeTx(linhaPersistida?: Record<string, unknown>) {
  return {
    egestorContatoConsolidado: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(
          linhaPersistida ?? { id: 'mirror-1', cpfCnpj: '11111111000100' },
        ),
    },
  } as unknown as Parameters<
    EgestorWebhookProcessingService['finalizarEvento']
  >[0];
}

describe('EgestorWebhookProcessingService', () => {
  describe('buscarContatoFresco', () => {
    it('action=deleted: não chama a API, devolve null direto', async () => {
      const { service, auth, http } = criarService({});

      const resultado = await service.buscarContatoFresco(
        'matriz',
        'deleted',
        '109',
      );

      expect(resultado).toBeNull();
      expect(auth.getAccessToken).not.toHaveBeenCalled();
      expect(http.getOne).not.toHaveBeenCalled();
    });

    it('action=updated: busca o access_token da conta certa e chama GET /contatos/{codigo}', async () => {
      const httpGetOne = jest
        .fn()
        .mockResolvedValue({ codigo: 5, tipo: ['cliente'] });
      const { service, auth } = criarService({ httpGetOne });

      const resultado = await service.buscarContatoFresco(
        'filial',
        'updated',
        '5',
      );

      expect(auth.getAccessToken).toHaveBeenCalledWith('filial');
      expect(httpGetOne).toHaveBeenCalledWith('token-x', '/v1/contatos/5');
      expect(resultado).toEqual({ codigo: 5, tipo: ['cliente'] });
    });

    it('propaga erro do GET (não trata 404 como "excluído" por inferência)', async () => {
      const httpGetOne = jest.fn().mockRejectedValue(new Error('HTTP 404'));
      const { service } = criarService({ httpGetOne });

      await expect(
        service.buscarContatoFresco('matriz', 'updated', '999'),
      ).rejects.toThrow('HTTP 404');
    });
  });

  describe('planejarEvento', () => {
    it('sem CNPJ resolvível — plano "sem_cnpj"', async () => {
      const { service } = criarService({});
      const tx = {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never;

      const plano = await service.planejarEvento(
        tx,
        'ws-1',
        'matriz',
        'updated',
        '109',
        null,
      );

      expect(plano).toEqual({ tipo: 'sem_cnpj' });
    });

    it('divergência real, evento na MATRIZ — plano "corrigir_divergencia", direção matriz_para_filial', async () => {
      const { service } = criarService({});
      const mirrorExistente = {
        cpfCnpj: '59334901000162',
        codigoMatriz: '334',
        codigoFilial: '341',
        dadosFilial: {
          codigo: 341,
          cpfcnpj: '59334901000162',
          tipo: ['cliente', 'fornecedor'],
        },
      };
      const tx = {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(mirrorExistente),
        },
      } as never;

      const plano = await service.planejarEvento(
        tx,
        'ws-1',
        'matriz',
        'updated',
        '334',
        { codigo: 334, cpfcnpj: '59334901000162', tipo: ['fornecedor'] }, // Matriz desmarcou "cliente"
      );

      expect(plano.tipo).toBe('corrigir_divergencia');
      if (plano.tipo === 'corrigir_divergencia') {
        expect(plano.row.status).toBe('ambos_diferentes');
        expect(plano.row.codigoMatriz).toBe('334');
        expect(plano.row.codigoFilial).toBe('341');
        // Evento chegou pela Matriz — ela é quem acabou de ser editada,
        // então a correção vai pra Filial (regra 2, recalibrada 2026-08-13).
        expect(plano.direcao).toBe('matriz_para_filial');
      }
    });

    it('divergência real, evento na FILIAL — plano "corrigir_divergencia", direção filial_para_matriz (regra recalibrada 2026-08-13, caso real MAGALI)', async () => {
      const { service } = criarService({});
      const mirrorExistente = {
        cpfCnpj: '59334901000162',
        codigoMatriz: '334',
        codigoFilial: '341',
        dadosMatriz: {
          codigo: 334,
          cpfcnpj: '59334901000162',
          tipo: ['cliente', 'fornecedor'],
        },
      };
      const tx = {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(mirrorExistente),
        },
      } as never;

      const plano = await service.planejarEvento(
        tx,
        'ws-1',
        'filial',
        'updated',
        '341',
        { codigo: 341, cpfcnpj: '59334901000162', tipo: ['fornecedor'] }, // Filial desmarcou "cliente" de propósito
      );

      expect(plano.tipo).toBe('corrigir_divergencia');
      if (plano.tipo === 'corrigir_divergencia') {
        expect(plano.row.status).toBe('ambos_diferentes');
        // Evento chegou pela Filial — a correção vai pra Matriz, não o
        // contrário (comportamento antigo revertia a edição da Filial).
        expect(plano.direcao).toBe('filial_para_matriz');
      }
    });

    it('sem divergência (ambos_iguais) — plano "avaliar"', async () => {
      const { service } = criarService({});
      const mirrorExistente = {
        cpfCnpj: '11111111000100',
        codigoMatriz: '1',
        codigoFilial: '2',
        dadosFilial: {
          codigo: 2,
          cpfcnpj: '11111111000100',
          nome: 'X',
          tipo: ['cliente'],
        },
      };
      const tx = {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(mirrorExistente),
        },
      } as never;

      const plano = await service.planejarEvento(
        tx,
        'ws-1',
        'matriz',
        'updated',
        '1',
        { codigo: 1, cpfcnpj: '11111111000100', nome: 'X', tipo: ['cliente'] },
      );

      expect(plano.tipo).toBe('avaliar');
      if (plano.tipo === 'avaliar')
        expect(plano.row.status).toBe('ambos_iguais');
    });

    it('so_matriz, cliente, evento "created" (contato novo, sem espelho) — plano "completar_lado_faltante" (regra 6, 2026-08-13)', async () => {
      const { service } = criarService({});
      const tx = {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never;

      const plano = await service.planejarEvento(
        tx,
        'ws-1',
        'matriz',
        'created',
        '1',
        { codigo: 1, cpfcnpj: '22222222000100', tipo: ['cliente'] },
      );

      expect(plano.tipo).toBe('completar_lado_faltante');
      if (plano.tipo === 'completar_lado_faltante') {
        expect(plano.row.status).toBe('so_matriz');
      }
    });

    it('so_matriz, cliente, evento "deleted" — plano "avaliar", nunca recria o que acabou de ser apagado', async () => {
      const { service } = criarService({});
      const mirrorExistente = {
        cpfCnpj: '22222222000100',
        codigoMatriz: '1',
        codigoFilial: null,
        dadosMatriz: null,
        dadosFilial: null,
      };
      const tx = {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(mirrorExistente),
        },
      } as never;

      // action=deleted → contatoFresco null (mesmo contrato de buscarContatoFresco).
      const plano = await service.planejarEvento(
        tx,
        'ws-1',
        'matriz',
        'deleted',
        '1',
        null,
      );

      expect(plano.tipo).toBe('avaliar');
    });

    it('so_matriz, NÃO cliente, evento "created" — plano "avaliar", não espalha fornecedor pras duas contas', async () => {
      const { service } = criarService({});
      const tx = {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never;

      const plano = await service.planejarEvento(
        tx,
        'ws-1',
        'matriz',
        'created',
        '1',
        { codigo: 1, cpfcnpj: '22222222000100', tipo: ['fornecedor'] },
      );

      expect(plano.tipo).toBe('avaliar');
      if (plano.tipo === 'avaliar') expect(plano.row.status).toBe('so_matriz');
    });
  });

  describe('aplicarCorrecaoAutomatica', () => {
    // Regra recalibrada (2026-08-13): a direção não é mais fixa, vem do
    // plano (planejarEvento) — este método só repassa pra
    // EgestorContatoCorrectionService, sem decidir nada sozinho.
    it('repassa a direção matriz_para_filial quando é o que o plano decidiu', async () => {
      const correctionAplicar = jest.fn().mockResolvedValue({
        camposCorrigidos: ['tipo'],
        dadosDestinoAtualizados: {},
        estabelecimentoEscrito: 'filial',
        codigoEscrito: '341',
      });
      const { service, correction } = criarService({ correctionAplicar });
      const row = {
        cpfCnpj: '59334901000162',
        status: 'ambos_diferentes' as const,
        codigoMatriz: '334',
        codigoFilial: '341',
        nomeMatriz: 'Magali',
        nomeFilial: 'Magali',
        dadosMatriz: { codigo: 334, tipo: ['fornecedor'] },
        dadosFilial: { codigo: 341, tipo: ['cliente', 'fornecedor'] },
        camposDiferentes: ['tipo'],
      };

      await service.aplicarCorrecaoAutomatica(row, 'matriz_para_filial');

      expect(correction.aplicarCorrecaoNoEgestor).toHaveBeenCalledWith(
        expect.objectContaining({
          codigoMatriz: '334',
          codigoFilial: '341',
          camposDiferentes: ['tipo'],
        }),
        'matriz_para_filial',
      );
    });

    it('repassa a direção filial_para_matriz quando é o que o plano decidiu (caso MAGALI: evento veio da Filial)', async () => {
      const correctionAplicar = jest.fn().mockResolvedValue({
        camposCorrigidos: ['tipo'],
        dadosDestinoAtualizados: {},
        estabelecimentoEscrito: 'matriz',
        codigoEscrito: '334',
      });
      const { service, correction } = criarService({ correctionAplicar });
      const row = {
        cpfCnpj: '59334901000162',
        status: 'ambos_diferentes' as const,
        codigoMatriz: '334',
        codigoFilial: '341',
        nomeMatriz: 'Magali',
        nomeFilial: 'Magali',
        dadosMatriz: { codigo: 334, tipo: ['cliente', 'fornecedor'] },
        dadosFilial: { codigo: 341, tipo: ['fornecedor'] },
        camposDiferentes: ['tipo'],
      };

      await service.aplicarCorrecaoAutomatica(row, 'filial_para_matriz');

      expect(correction.aplicarCorrecaoNoEgestor).toHaveBeenCalledWith(
        expect.objectContaining({
          codigoMatriz: '334',
          codigoFilial: '341',
          camposDiferentes: ['tipo'],
        }),
        'filial_para_matriz',
      );
    });
  });

  describe('aplicarCompletarAutomatico', () => {
    // Regra 6 (2026-08-13) — delega pra completarNoEgestor, que decide o
    // destino sozinho a partir de `row.status` (so_matriz → completa
    // Filial, so_filial → completa Matriz).
    it('repassa status/dadosMatriz/dadosFilial da linha calculada, sem inventar campo', async () => {
      const correctionCompletar = jest.fn().mockResolvedValue({
        codigoNovo: '999',
        dadosNovo: {
          codigo: 999,
          cpfcnpj: '22222222000100',
          nome: 'X',
          tipo: ['cliente'],
        },
        estabelecimentoEscrito: 'filial',
      });
      const { service, correction } = criarService({ correctionCompletar });
      const row = {
        cpfCnpj: '22222222000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: {
          codigo: 1,
          cpfcnpj: '22222222000100',
          nome: 'X',
          tipo: ['cliente'],
        },
        dadosFilial: null,
        camposDiferentes: [],
      };

      const resultado = await service.aplicarCompletarAutomatico(row);

      expect(correction.completarNoEgestor).toHaveBeenCalledWith({
        status: 'so_matriz',
        dadosMatriz: row.dadosMatriz,
        dadosFilial: null,
      });
      expect(resultado.estabelecimentoEscrito).toBe('filial');
      expect(resultado.codigoNovo).toBe('999');
    });
  });

  describe('finalizarEvento', () => {
    it('plano sem_cnpj — devolve sem_cnpj_ignorado sem tocar em nada', async () => {
      const { service } = criarService({});
      const tx = fakeTx();

      const resultado = await service.finalizarEvento(tx, 'ws-1', membership, {
        tipo: 'sem_cnpj',
      });

      expect(resultado).toBe('sem_cnpj_ignorado');
    });

    it('corrigir_divergencia sem resultadoCorrecao — lança (proteção defensiva)', async () => {
      const { service } = criarService({});
      const tx = fakeTx();
      const row = {
        cpfCnpj: '1',
        status: 'ambos_diferentes' as const,
        codigoMatriz: '1',
        codigoFilial: '2',
        nomeMatriz: null,
        nomeFilial: null,
        dadosMatriz: { codigo: 1, tipo: ['cliente'] },
        dadosFilial: { codigo: 2, tipo: ['fornecedor'] },
        camposDiferentes: ['tipo'],
      };

      await expect(
        service.finalizarEvento(tx, 'ws-1', membership, {
          tipo: 'corrigir_divergencia',
          cnpj: '1',
          row,
          mirrorExistente: null,
          direcao: 'matriz_para_filial',
        }),
      ).rejects.toThrow('correção automática');
    });

    it('caso simulado (2026-08-12, pré-recalibração): corrige a divergência, Matriz não é mais cliente → reconcilia (desativa) em vez de promover', async () => {
      const syncReconciliarContatoUnico = jest
        .fn()
        .mockResolvedValue({ desativouCompany: true });
      const { service, sync, promote } = criarService({
        syncReconciliarContatoUnico,
      });
      const mirrorExistente = {
        id: 'mirror-magali',
        cpfCnpj: '59334901000162',
        companyId: 'company-magali',
      } as never;
      const tx = fakeTx();
      const row = {
        cpfCnpj: '59334901000162',
        status: 'ambos_diferentes' as const,
        codigoMatriz: '334',
        codigoFilial: '341',
        nomeMatriz: 'Magali',
        nomeFilial: 'Magali',
        dadosMatriz: {
          codigo: 334,
          cpfcnpj: '59334901000162',
          tipo: ['fornecedor'],
        }, // Matriz: só fornecedor
        dadosFilial: {
          codigo: 341,
          cpfcnpj: '59334901000162',
          tipo: ['cliente', 'fornecedor'],
        }, // Filial: ainda tinha cliente (antes da correção)
        camposDiferentes: ['tipo'],
      };
      const resultadoCorrecao = {
        camposCorrigidos: ['tipo'],
        dadosDestinoAtualizados: {
          codigo: 341,
          cpfcnpj: '59334901000162',
          tipo: ['fornecedor'],
        }, // Filial corrigida = igual à Matriz agora
        estabelecimentoEscrito: 'filial' as const,
        codigoEscrito: '341',
      };

      const resultado = await service.finalizarEvento(
        tx,
        'ws-1',
        membership,
        {
          tipo: 'corrigir_divergencia',
          cnpj: '59334901000162',
          row,
          mirrorExistente,
          direcao: 'matriz_para_filial',
        },
        resultadoCorrecao,
      );

      // Não promove — Matriz (fonte da verdade) não é mais cliente, e
      // agora a Filial corrigida também não é.
      expect(promote.promoverLinha).not.toHaveBeenCalled();
      expect(sync.reconciliarContatoUnico).toHaveBeenCalledWith(
        tx,
        membership,
        mirrorExistente,
      );
      expect(resultado).toBe('desativada_nao_e_mais_cliente');
    });

    it('caso real recalibrado (MAGALI, 2026-08-13): evento veio da FILIAL, correção aplicada na MATRIZ (não o contrário) → reconcilia', async () => {
      const syncReconciliarContatoUnico = jest
        .fn()
        .mockResolvedValue({ desativouCompany: true });
      const { service, sync, promote } = criarService({
        syncReconciliarContatoUnico,
      });
      const mirrorExistente = {
        id: 'mirror-magali',
        cpfCnpj: '59334901000162',
        companyId: 'company-magali',
      } as never;
      const tx = fakeTx();
      const row = {
        cpfCnpj: '59334901000162',
        status: 'ambos_diferentes' as const,
        codigoMatriz: '334',
        codigoFilial: '341',
        nomeMatriz: 'Magali',
        nomeFilial: 'Magali',
        // Antes do evento: os dois lados tinham cliente+fornecedor (iguais).
        // Usuário editou a Filial de propósito pra só fornecedor — o
        // espelho local ainda reflete a Matriz com o valor antigo até este
        // evento processar.
        dadosMatriz: {
          codigo: 334,
          cpfcnpj: '59334901000162',
          tipo: ['cliente', 'fornecedor'],
        },
        dadosFilial: {
          codigo: 341,
          cpfcnpj: '59334901000162',
          tipo: ['fornecedor'],
        },
        camposDiferentes: ['tipo'],
      };
      const resultadoCorrecao = {
        camposCorrigidos: ['tipo'],
        dadosDestinoAtualizados: {
          codigo: 334,
          cpfcnpj: '59334901000162',
          tipo: ['fornecedor'],
        }, // Matriz corrigida = igual à Filial agora
        estabelecimentoEscrito: 'matriz' as const,
        codigoEscrito: '334',
      };

      const resultado = await service.finalizarEvento(
        tx,
        'ws-1',
        membership,
        {
          tipo: 'corrigir_divergencia',
          cnpj: '59334901000162',
          row,
          mirrorExistente,
          direcao: 'filial_para_matriz',
        },
        resultadoCorrecao,
      );

      // A Matriz corrigida também não é mais cliente — reconcilia, não
      // promove. O ponto do teste é a Matriz ter sido o lado ESCRITO
      // (branch `dadosMatriz`), não o resultado em si (já coberto acima).
      expect(promote.promoverLinha).not.toHaveBeenCalled();
      expect(sync.reconciliarContatoUnico).toHaveBeenCalledWith(
        tx,
        membership,
        mirrorExistente,
      );
      expect(resultado).toBe('desativada_nao_e_mais_cliente');
    });

    it('corrige a divergência mas Matriz AINDA é cliente — persiste a linha corrigida e promove', async () => {
      const promoverLinha = jest
        .fn()
        .mockImplementation(async (_tx, _wsId, _row, summary) => {
          summary.vinculadasExistente += 1;
        });
      const { service, sync, promote } = criarService({ promoverLinha });
      const tx = fakeTx({ id: 'mirror-1', cpfCnpj: '11111111000100' });
      const row = {
        cpfCnpj: '11111111000100',
        status: 'ambos_diferentes' as const,
        codigoMatriz: '1',
        codigoFilial: '2',
        nomeMatriz: 'Empresa X',
        nomeFilial: 'Empresa X Errado',
        dadosMatriz: { codigo: 1, nome: 'Empresa X', tipo: ['cliente'] },
        dadosFilial: { codigo: 2, nome: 'Empresa X Errado', tipo: ['cliente'] },
        camposDiferentes: ['nome'],
      };
      const resultadoCorrecao = {
        camposCorrigidos: ['nome'],
        dadosDestinoAtualizados: {
          codigo: 2,
          nome: 'Empresa X',
          tipo: ['cliente'],
        },
        estabelecimentoEscrito: 'filial' as const,
        codigoEscrito: '2',
      };

      const resultado = await service.finalizarEvento(
        tx,
        'ws-1',
        membership,
        {
          tipo: 'corrigir_divergencia',
          cnpj: '11111111000100',
          row,
          mirrorExistente: null,
          direcao: 'matriz_para_filial',
        },
        resultadoCorrecao,
      );

      expect(sync.persistirLinhaCalculada).toHaveBeenCalledWith(
        tx,
        'ws-1',
        expect.objectContaining({
          status: 'ambos_iguais',
          camposDiferentes: [],
          dadosFilial: resultadoCorrecao.dadosDestinoAtualizados,
        }),
      );
      expect(promote.promoverLinha).toHaveBeenCalled();
      expect(resultado).toBe('vinculada_a_company_existente');
    });

    it('plano "avaliar", ainda é cliente — promove/atualiza normalmente', async () => {
      const promoverLinha = jest
        .fn()
        .mockImplementation(async (_tx, _wsId, _row, summary) => {
          summary.criadasNovas += 1;
        });
      const { service, promote } = criarService({ promoverLinha });
      const tx = fakeTx();
      const row = {
        cpfCnpj: '33333333000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: { codigo: 1, tipo: ['cliente'] },
        dadosFilial: null,
        camposDiferentes: [],
      };

      const resultado = await service.finalizarEvento(tx, 'ws-1', membership, {
        tipo: 'avaliar',
        cnpj: '33333333000100',
        row,
        mirrorExistente: null,
      });

      expect(promote.promoverLinha).toHaveBeenCalled();
      expect(resultado).toBe('company_criada');
    });

    it('plano "avaliar", não é cliente e nunca foi rastreado — nao_e_cliente_nunca_rastreado', async () => {
      const { service, sync } = criarService({});
      const tx = fakeTx();
      const row = {
        cpfCnpj: '44444444000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: { codigo: 1, tipo: ['fornecedor'] },
        dadosFilial: null,
        camposDiferentes: [],
      };

      const resultado = await service.finalizarEvento(tx, 'ws-1', membership, {
        tipo: 'avaliar',
        cnpj: '44444444000100',
        row,
        mirrorExistente: null,
      });

      expect(sync.reconciliarContatoUnico).not.toHaveBeenCalled();
      expect(resultado).toBe('nao_e_cliente_nunca_rastreado');
    });

    it('plano "avaliar", não é cliente mas já estava rastreado/promovido — reconcilia', async () => {
      const syncReconciliarContatoUnico = jest
        .fn()
        .mockResolvedValue({ desativouCompany: true });
      const { service, sync } = criarService({ syncReconciliarContatoUnico });
      const tx = fakeTx();
      const mirrorExistente = {
        id: 'mirror-1',
        cpfCnpj: '55555555000100',
        companyId: 'company-1',
      } as never;
      const row = {
        cpfCnpj: '55555555000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: { codigo: 1, tipo: ['fornecedor'] },
        dadosFilial: null,
        camposDiferentes: [],
      };

      const resultado = await service.finalizarEvento(tx, 'ws-1', membership, {
        tipo: 'avaliar',
        cnpj: '55555555000100',
        row,
        mirrorExistente,
      });

      expect(sync.reconciliarContatoUnico).toHaveBeenCalledWith(
        tx,
        membership,
        mirrorExistente,
      );
      expect(resultado).toBe('desativada_nao_e_mais_cliente');
    });

    it('erro ao promover — devolve resultado de erro, não lança', async () => {
      const promoverLinha = jest
        .fn()
        .mockImplementation(async (_tx, _wsId, _row, summary) => {
          summary.erros.push({
            cpfCnpj: '66666666000100',
            motivo: 'Sem dados em nenhum dos dois lados.',
          });
        });
      const { service } = criarService({ promoverLinha });
      const tx = fakeTx();
      const row = {
        cpfCnpj: '66666666000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: { codigo: 1, tipo: ['cliente'] },
        dadosFilial: null,
        camposDiferentes: [],
      };

      const resultado = await service.finalizarEvento(tx, 'ws-1', membership, {
        tipo: 'avaliar',
        cnpj: '66666666000100',
        row,
        mirrorExistente: null,
      });

      expect(resultado).toBe(
        'erro_ao_promover: Sem dados em nenhum dos dois lados.',
      );
    });

    it('erro ao desativar — devolve resultado de erro, não lança', async () => {
      const syncReconciliarContatoUnico = jest
        .fn()
        .mockResolvedValue({ desativouCompany: false, erro: 'sem permissão' });
      const { service } = criarService({ syncReconciliarContatoUnico });
      const tx = fakeTx();
      const mirrorExistente = {
        id: 'mirror-1',
        cpfCnpj: '77777777000100',
        companyId: 'company-1',
      } as never;
      const row = {
        cpfCnpj: '77777777000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: { codigo: 1, tipo: ['fornecedor'] },
        dadosFilial: null,
        camposDiferentes: [],
      };

      const resultado = await service.finalizarEvento(tx, 'ws-1', membership, {
        tipo: 'avaliar',
        cnpj: '77777777000100',
        row,
        mirrorExistente,
      });

      expect(resultado).toBe('erro_ao_desativar: sem permissão');
    });

    it('completar_lado_faltante sem resultadoCompletar — lança (proteção defensiva)', async () => {
      const { service } = criarService({});
      const tx = fakeTx();
      const row = {
        cpfCnpj: '22222222000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: { codigo: 1, tipo: ['cliente'] },
        dadosFilial: null,
        camposDiferentes: [],
      };

      await expect(
        service.finalizarEvento(tx, 'ws-1', membership, {
          tipo: 'completar_lado_faltante',
          cnpj: '22222222000100',
          row,
          mirrorExistente: null,
        }),
      ).rejects.toThrow('completar o lado faltante');
    });

    it('completar_lado_faltante (regra 6, 2026-08-13): completa a Filial, persiste ambos_iguais e promove', async () => {
      const promoverLinha = jest
        .fn()
        .mockImplementation(async (_tx, _wsId, _row, summary) => {
          summary.criadasNovas += 1;
        });
      const { service, sync, promote } = criarService({ promoverLinha });
      const tx = fakeTx();
      const row = {
        cpfCnpj: '22222222000100',
        status: 'so_matriz' as const,
        codigoMatriz: '1',
        codigoFilial: null,
        nomeMatriz: 'X',
        nomeFilial: null,
        dadosMatriz: {
          codigo: 1,
          cpfcnpj: '22222222000100',
          nome: 'X',
          tipo: ['cliente'],
        },
        dadosFilial: null,
        camposDiferentes: [],
      };
      const resultadoCompletar = {
        codigoNovo: '999',
        dadosNovo: {
          codigo: 999,
          cpfcnpj: '22222222000100',
          nome: 'X',
          tipo: ['cliente'],
        },
        estabelecimentoEscrito: 'filial' as const,
      };

      const resultado = await service.finalizarEvento(
        tx,
        'ws-1',
        membership,
        {
          tipo: 'completar_lado_faltante',
          cnpj: '22222222000100',
          row,
          mirrorExistente: null,
        },
        undefined,
        resultadoCompletar,
      );

      expect(sync.persistirLinhaCalculada).toHaveBeenCalledWith(
        tx,
        'ws-1',
        expect.objectContaining({
          status: 'ambos_iguais',
          camposDiferentes: [],
          codigoFilial: '999',
          dadosFilial: resultadoCompletar.dadosNovo,
          nomeFilial: 'X',
          // Lado que já existia (Matriz) fica intocado.
          codigoMatriz: '1',
          dadosMatriz: row.dadosMatriz,
        }),
      );
      expect(promote.promoverLinha).toHaveBeenCalled();
      expect(resultado).toBe('company_criada');
    });
  });
});
