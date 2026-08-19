import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EgestorContatoStatus } from '@prisma/client';
import type { EgestorContatoConsolidado } from '@prisma/client';
import type { CompanyService } from '../../companies/company.service';
import type { EgestorAuthService } from './egestor-auth.service';
import {
  calcularCrmCamposDivergentes,
  EgestorContatoCorrectionService,
} from './egestor-contato-correction.service';
import type { EgestorHttpService } from './egestor-http.service';
import type { EgestorWebhookEchoService } from './egestor-webhook-echo.service';

// Linha mínima válida pra corrigir (ambos_diferentes, 2 códigos, 2 lados
// de dado) — sobrescreve só o que o teste precisa.
function linha(
  overrides: Partial<EgestorContatoConsolidado> = {},
): EgestorContatoConsolidado {
  return {
    id: 'row-1',
    workspaceId: 'ws-1',
    cpfCnpj: '11111111000100',
    status: EgestorContatoStatus.ambos_diferentes,
    codigoMatriz: '10',
    codigoFilial: '20',
    nomeMatriz: 'Empresa Matriz',
    nomeFilial: 'Empresa Filial Errado',
    dadosMatriz: {
      codigo: 10,
      nome: 'Empresa Matriz',
      logradouro: 'Rua Certa',
    },
    dadosFilial: {
      codigo: 20,
      nome: 'Empresa Filial Errado',
      logradouro: 'Rua Errada',
    },
    camposDiferentes: ['nome', 'logradouro'],
    companyId: null,
    lastSyncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Cadastro CRM mínimo — sobrescreve só o que o teste precisa, resto
// fica `null` (mesmo racional de linha() acima).
function crm(
  overrides: Partial<Record<string, string | string[] | null>> = {},
) {
  return {
    razaoSocial: null,
    fantasia: null,
    nomeParaContato: null,
    cpfCnpj: null,
    emails: [],
    fones: [],
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cep: null,
    uf: null,
    cidade: null,
    inscricaoEstadual: null,
    indicadorIE: null,
    ...overrides,
  } as import('./egestor-contato-correction.service').CrmContatoFonte;
}

function criarTx(row: EgestorContatoConsolidado | null) {
  return {
    egestorContatoConsolidado: {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue(row ? [row] : []),
      update: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as import('../../tenancy/tenant-context.service').TenantTx;
}

describe('EgestorContatoCorrectionService', () => {
  describe('buscarParaCorrecao', () => {
    it('lança NotFoundException quando o registro não existe no workspace', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const tx = criarTx(null);

      await expect(
        service.buscarParaCorrecao(tx, 'ws-1', 'row-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException quando o status não é ambos_diferentes', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const tx = criarTx(linha({ status: EgestorContatoStatus.ambos_iguais }));

      await expect(
        service.buscarParaCorrecao(tx, 'ws-1', 'row-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lança BadRequestException quando falta um dos dois códigos', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const tx = criarTx(linha({ codigoFilial: null }));

      await expect(
        service.buscarParaCorrecao(tx, 'ws-1', 'row-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('devolve a linha quando tudo válido', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const row = linha();
      const tx = criarTx(row);

      await expect(
        service.buscarParaCorrecao(tx, 'ws-1', 'row-1'),
      ).resolves.toEqual(row);
    });
  });

  describe('aplicarCorrecaoNoEgestor', () => {
    it('matriz_para_filial: pede token da Filial, busca o registro atual dela e grava lá os campos divergentes vindos da Matriz', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest.fn().mockResolvedValue({
          codigo: '20',
          nome: 'Empresa Filial Errado',
          logradouro: 'Rua Errada',
          fantasia: 'Mantém isso', // campo fora de CAMPOS_CONTATO/camposDiferentes, não pode sumir
        }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const resultado = await service.aplicarCorrecaoNoEgestor(
        linha(),
        'matriz_para_filial',
      );

      expect(auth.getAccessToken).toHaveBeenCalledWith('filial');
      expect(http.getOne).toHaveBeenCalledWith(
        'token-filial',
        '/v1/contatos/20',
      );
      expect(http.put).toHaveBeenCalledWith(
        'token-filial',
        '/v1/contatos/20',
        expect.objectContaining({
          nome: 'Empresa Matriz',
          logradouro: 'Rua Certa',
          fantasia: 'Mantém isso',
        }),
      );
      // `codigo` nunca vai no corpo do PUT, só na URL.
      expect((http.put as jest.Mock).mock.calls[0][2]).not.toHaveProperty(
        'codigo',
      );
      expect(resultado.camposCorrigidos).toEqual(['nome', 'logradouro']);
      expect(resultado.dadosDestinoAtualizados).toMatchObject({
        nome: 'Empresa Matriz',
        logradouro: 'Rua Certa',
      });
    });

    it('filial_para_matriz: pede token da Matriz e grava lá', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-matriz'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest.fn().mockResolvedValue({
          codigo: '10',
          nome: 'Empresa Matriz',
          logradouro: 'Rua Certa',
        }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await service.aplicarCorrecaoNoEgestor(linha(), 'filial_para_matriz');

      expect(auth.getAccessToken).toHaveBeenCalledWith('matriz');
      expect(http.getOne).toHaveBeenCalledWith(
        'token-matriz',
        '/v1/contatos/10',
      );
      expect(http.put).toHaveBeenCalledWith(
        'token-matriz',
        '/v1/contatos/10',
        expect.objectContaining({
          nome: 'Empresa Filial Errado',
          logradouro: 'Rua Errada',
        }),
      );
    });

    it('nunca reenvia dtCad/cidade no corpo do PUT (campos somente-leitura no eGestor — 422 confirmado contra a API real em 2026-08-11)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest.fn().mockResolvedValue({
          codigo: '20',
          nome: 'Empresa Filial Errado',
          dtCad: '2020-01-01 10:00:00',
          cidade: 'São Paulo',
        }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await service.aplicarCorrecaoNoEgestor(linha(), 'matriz_para_filial');

      const payloadEnviado = (http.put as jest.Mock).mock.calls[0][2];
      expect(payloadEnviado).not.toHaveProperty('dtCad');
      expect(payloadEnviado).not.toHaveProperty('cidade');
    });

    it('nunca reenvia campo fora do whitelist CAMPOS_CONTATO (bloco "Entrega", suframa, etc. — 422 "cidadeEntrega é somente para leitura" confirmado contra a API real em 2026-08-11)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest.fn().mockResolvedValue({
          codigo: '20',
          nome: 'Empresa Filial Errado',
          cidadeEntrega: 'São Paulo',
          logradouroEntrega: 'Rua Entrega',
          cepEntrega: 12345,
          suframa: '',
          inscricaoEstadualST: '',
          pais: 'Brasil',
        }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await service.aplicarCorrecaoNoEgestor(linha(), 'matriz_para_filial');

      const payloadEnviado = (http.put as jest.Mock).mock.calls[0][2];
      expect(payloadEnviado).not.toHaveProperty('cidadeEntrega');
      expect(payloadEnviado).not.toHaveProperty('logradouroEntrega');
      expect(payloadEnviado).not.toHaveProperty('cepEntrega');
      expect(payloadEnviado).not.toHaveProperty('suframa');
      expect(payloadEnviado).not.toHaveProperty('inscricaoEstadualST');
      expect(payloadEnviado).not.toHaveProperty('pais');
    });

    it('converte indicadorIE: 0 pra 9 antes de gravar (regra do script de referência)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest
          .fn()
          .mockResolvedValue({ codigo: '20', nome: 'x', indicadorIE: 0 }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await service.aplicarCorrecaoNoEgestor(linha(), 'matriz_para_filial');

      expect((http.put as jest.Mock).mock.calls[0][2]).toMatchObject({
        indicadorIE: 9,
      });
    });
  });

  describe('persistirCorrecao', () => {
    it('matriz_para_filial: grava dadosFilial/nomeFilial e zera a divergência', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const tx = criarTx(linha());

      const resultado = await service.persistirCorrecao(
        tx,
        'row-1',
        'ws-1',
        'matriz_para_filial',
        {
          camposCorrigidos: ['nome', 'logradouro'],
          dadosDestinoAtualizados: {
            codigo: 20,
            nome: 'Empresa Matriz',
            logradouro: 'Rua Certa',
          },
          estabelecimentoEscrito: 'filial',
          codigoEscrito: '20',
        },
      );

      expect(resultado).toEqual({
        camposCorrigidos: ['nome', 'logradouro'],
        statusFinal: EgestorContatoStatus.ambos_iguais,
      });
      const updateArg = (tx.egestorContatoConsolidado.update as jest.Mock).mock
        .calls[0][0];
      expect(updateArg.where).toEqual({ id: 'row-1' });
      expect(updateArg.data.status).toBe(EgestorContatoStatus.ambos_iguais);
      expect(updateArg.data.camposDiferentes).toEqual([]);
      expect(updateArg.data.nomeFilial).toBe('Empresa Matriz');
      expect(updateArg.data.dadosFilial).toMatchObject({
        nome: 'Empresa Matriz',
      });
      expect(updateArg.data.dadosMatriz).toBeUndefined();
    });

    it('filial_para_matriz: grava dadosMatriz/nomeMatriz', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const tx = criarTx(linha());

      await service.persistirCorrecao(
        tx,
        'row-1',
        'ws-1',
        'filial_para_matriz',
        {
          camposCorrigidos: ['nome'],
          dadosDestinoAtualizados: {
            codigo: 10,
            nome: 'Empresa Filial Errado',
          },
          estabelecimentoEscrito: 'matriz',
          codigoEscrito: '10',
        },
      );

      const updateArg = (tx.egestorContatoConsolidado.update as jest.Mock).mock
        .calls[0][0];
      expect(updateArg.data.nomeMatriz).toBe('Empresa Filial Errado');
      expect(updateArg.data.dadosFilial).toBeUndefined();
    });
  });

  describe('Consolidar (aplicarConsolidacaoNoEgestor / persistirConsolidacao)', () => {
    function linhaComEmails(): EgestorContatoConsolidado {
      return linha({
        camposDiferentes: ['nome', 'emails'],
        dadosMatriz: {
          codigo: 10,
          nome: 'Empresa Matriz',
          emails: ['fabio@exemplo.com.br'],
        },
        dadosFilial: {
          codigo: 20,
          nome: 'Empresa Filial Errado',
          emails: ['contato@exemplo.com.br'],
        },
      });
    }

    describe('aplicarConsolidacaoNoEgestor', () => {
      it('lança BadRequestException quando nenhum campo divergente é de lista', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );

        await expect(
          service.aplicarConsolidacaoNoEgestor(linha()), // camposDiferentes: nome/logradouro, nenhum de lista
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('une os e-mails dos dois lados (sem duplicata) e grava nos DOIS contatos', async () => {
        const auth = {
          getAccessToken: jest
            .fn()
            .mockImplementation((estabelecimento: string) =>
              Promise.resolve(`token-${estabelecimento}`),
            ),
        } as unknown as EgestorAuthService;
        const http = {
          getOne: jest.fn().mockImplementation((_token: string, path: string) =>
            Promise.resolve(
              path.endsWith('/10')
                ? {
                    codigo: '10',
                    nome: 'Empresa Matriz',
                    emails: ['fabio@exemplo.com.br'],
                  }
                : {
                    codigo: '20',
                    nome: 'Empresa Filial Errado',
                    emails: ['contato@exemplo.com.br'],
                  },
            ),
          ),
          put: jest.fn().mockResolvedValue({}),
        } as unknown as EgestorHttpService;
        const service = new EgestorContatoCorrectionService(
          auth,
          http,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );

        const resultado =
          await service.aplicarConsolidacaoNoEgestor(linhaComEmails());

        expect(auth.getAccessToken).toHaveBeenCalledWith('matriz');
        expect(auth.getAccessToken).toHaveBeenCalledWith('filial');
        expect(http.put).toHaveBeenCalledTimes(2);

        const [putMatrizCall, putFilialCall] = (http.put as jest.Mock).mock
          .calls;
        expect(putMatrizCall[1]).toBe('/v1/contatos/10');
        expect(putMatrizCall[2].emails).toEqual([
          'fabio@exemplo.com.br',
          'contato@exemplo.com.br',
        ]);
        expect(putFilialCall[1]).toBe('/v1/contatos/20');
        expect(putFilialCall[2].emails).toEqual([
          'fabio@exemplo.com.br',
          'contato@exemplo.com.br',
        ]);

        // campo escalar divergente (nome) não entra na consolidação.
        expect(resultado.camposConsolidados).toEqual(['emails']);
        expect(resultado.dadosMatrizAtualizados.emails).toEqual([
          'fabio@exemplo.com.br',
          'contato@exemplo.com.br',
        ]);
        expect(resultado.dadosFilialAtualizados.emails).toEqual([
          'fabio@exemplo.com.br',
          'contato@exemplo.com.br',
        ]);
      });

      it('deduplica case-insensitive quando os dois lados têm o mesmo e-mail em caixa diferente', async () => {
        const auth = {
          getAccessToken: jest.fn().mockResolvedValue('token'),
        } as unknown as EgestorAuthService;
        const http = {
          getOne: jest.fn().mockResolvedValue({ codigo: '10', nome: 'x' }),
          put: jest.fn().mockResolvedValue({}),
        } as unknown as EgestorHttpService;
        const service = new EgestorContatoCorrectionService(
          auth,
          http,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );

        const row = linha({
          camposDiferentes: ['emails'],
          dadosMatriz: {
            codigo: 10,
            nome: 'x',
            emails: ['Fulano@Exemplo.com'],
          },
          dadosFilial: {
            codigo: 20,
            nome: 'x',
            emails: ['fulano@exemplo.com'],
          },
        });

        const resultado = await service.aplicarConsolidacaoNoEgestor(row);

        expect(resultado.dadosMatrizAtualizados.emails).toEqual([
          'Fulano@Exemplo.com',
        ]);
      });
    });

    describe('persistirConsolidacao', () => {
      it('remove só os campos consolidados de camposDiferentes e vira ambos_iguais quando não sobra nada', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({ camposDiferentes: ['emails'] });
        const tx = criarTx(row);

        const resultado = await service.persistirConsolidacao(
          tx,
          'row-1',
          row,
          {
            camposConsolidados: ['emails'],
            dadosMatrizAtualizados: {
              codigo: 10,
              nome: 'x',
              emails: ['a@x.com', 'b@x.com'],
            },
            dadosFilialAtualizados: {
              codigo: 20,
              nome: 'x',
              emails: ['a@x.com', 'b@x.com'],
            },
            codigosEscritos: [
              { estabelecimento: 'matriz', codigo: '10' },
              { estabelecimento: 'filial', codigo: '20' },
            ],
          },
        );

        expect(resultado.statusFinal).toBe(EgestorContatoStatus.ambos_iguais);
        const updateArg = (tx.egestorContatoConsolidado.update as jest.Mock)
          .mock.calls[0][0];
        expect(updateArg.data.status).toBe(EgestorContatoStatus.ambos_iguais);
        expect(updateArg.data.camposDiferentes).toEqual([]);
        expect(updateArg.data.dadosMatriz.emails).toEqual([
          'a@x.com',
          'b@x.com',
        ]);
        expect(updateArg.data.dadosFilial.emails).toEqual([
          'a@x.com',
          'b@x.com',
        ]);
      });

      // Regressão: bug relatado pelo usuário em 2026-08-14 — a correção
      // gravava certo no eGestor e no JSON, mas as colunas denormalizadas
      // nomeMatriz/nomeFilial (que são o que a LISTA da tela exibe)
      // ficavam com o nome antigo pra sempre, dando a impressão de que só
      // um dos lados tinha sido corrigido.
      it('CRÍTICO: atualiza nomeMatriz/nomeFilial (colunas denormalizadas que a lista exibe), não só o JSON', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({
          camposDiferentes: ['nome'],
          nomeMatriz: 'EMPRESA EXEMPLO SERRALHERIA LTDA MATRIZ',
          nomeFilial: 'EMPRESA EXEMPLO SERRALHERIA LTDA',
        });
        const tx = criarTx(row);

        await service.persistirConsolidacao(tx, 'row-1', row, {
          camposConsolidados: ['nome'],
          dadosMatrizAtualizados: {
            codigo: 10,
            nome: 'EMPRESA EXEMPLO SERRALHERIA LTDA',
          },
          dadosFilialAtualizados: {
            codigo: 20,
            nome: 'EMPRESA EXEMPLO SERRALHERIA LTDA',
          },
          codigosEscritos: [
            { estabelecimento: 'matriz', codigo: '10' },
            { estabelecimento: 'filial', codigo: '20' },
          ],
        });

        const updateArg = (tx.egestorContatoConsolidado.update as jest.Mock)
          .mock.calls[0][0];
        expect(updateArg.data.nomeMatriz).toBe(
          'EMPRESA EXEMPLO SERRALHERIA LTDA',
        );
        expect(updateArg.data.nomeFilial).toBe(
          'EMPRESA EXEMPLO SERRALHERIA LTDA',
        );
      });

      it('mantém ambos_diferentes com o campo escalar restante quando a linha tinha mais de 1 divergência', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({ camposDiferentes: ['nome', 'emails'] });
        const tx = criarTx(row);

        const resultado = await service.persistirConsolidacao(
          tx,
          'row-1',
          row,
          {
            camposConsolidados: ['emails'],
            dadosMatrizAtualizados: {
              codigo: 10,
              nome: 'Empresa Matriz',
              emails: ['a@x.com'],
            },
            dadosFilialAtualizados: {
              codigo: 20,
              nome: 'Empresa Filial Errado',
              emails: ['a@x.com'],
            },
            codigosEscritos: [
              { estabelecimento: 'matriz', codigo: '10' },
              { estabelecimento: 'filial', codigo: '20' },
            ],
          },
        );

        expect(resultado.statusFinal).toBe(
          EgestorContatoStatus.ambos_diferentes,
        );
        const updateArg = (tx.egestorContatoConsolidado.update as jest.Mock)
          .mock.calls[0][0];
        expect(updateArg.data.status).toBe(
          EgestorContatoStatus.ambos_diferentes,
        );
        expect(updateArg.data.camposDiferentes).toEqual(['nome']);
      });
    });
  });

  describe('Corrigir com SEFAZ (aplicarCorrecaoSefazNoEgestor)', () => {
    function companiesMock(lookup: Partial<Record<string, string>>) {
      return {
        lookupCnpj: jest.fn().mockResolvedValue({
          emRecuperacaoJudicial: false,
          cpfCnpj: '11111111000100',
          tipo: 'PJ',
          emails: [],
          fones: [],
          ...lookup,
        }),
      } as unknown as CompanyService;
    }

    it('lança BadRequestException quando a Receita não traz valor útil pra nenhum campo divergente', async () => {
      const companies = companiesMock({}); // sem razaoSocial/logradouro etc.
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        companies,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await expect(
        service.aplicarCorrecaoSefazNoEgestor(linha()), // camposDiferentes: nome/logradouro
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('campo fora de CAMPOS_SEFAZ (emails) nunca entra, mesmo com valor na Receita — e campo coberto que já bate nos dois lados não gera PUT', async () => {
      const companies = companiesMock({ razaoSocial: 'Empresa X' });
      // Matriz e Filial já batem entre si E com a Receita pro único campo
      // coberto (nome) — "emails" tem valor na Receita mas não é campo
      // SEFAZ, nunca entra na comparação.
      const row = linha({
        camposDiferentes: ['emails'],
        dadosMatriz: { codigo: 10, nome: 'Empresa X' },
        dadosFilial: { codigo: 20, nome: 'Empresa X' },
      });
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        companies,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await expect(
        service.aplicarCorrecaoSefazNoEgestor(row),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('detecta e corrige quando Matriz e Filial JÁ SÃO IGUAIS entre si mas os dois divergem da Receita (status ambos_iguais, campo fora de camposDiferentes)', async () => {
      const auth = {
        getAccessToken: jest
          .fn()
          .mockImplementation((estabelecimento: string) =>
            Promise.resolve(`token-${estabelecimento}`),
          ),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest
          .fn()
          .mockImplementation((_token: string, path: string) =>
            Promise.resolve(
              path.endsWith('/10') ? { codigo: '10' } : { codigo: '20' },
            ),
          ),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const companies = companiesMock({
        razaoSocial: 'Empresa Oficial da Receita',
      });
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        companies,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      // camposDiferentes vazio (Matriz==Filial, sync nunca viu isso como
      // divergência) — mas os dois lados têm "nome" desatualizado.
      const row = linha({
        status: EgestorContatoStatus.ambos_iguais,
        camposDiferentes: [],
        dadosMatriz: { codigo: 10, nome: 'Empresa Desatualizada' },
        dadosFilial: { codigo: 20, nome: 'Empresa Desatualizada' },
      });

      const resultado = await service.aplicarCorrecaoSefazNoEgestor(row);

      expect(http.put).toHaveBeenCalledTimes(2);
      expect(resultado.camposConsolidados).toEqual(['nome']);
      expect(resultado.dadosMatrizAtualizados.nome).toBe(
        'Empresa Oficial da Receita',
      );
      expect(resultado.dadosFilialAtualizados.nome).toBe(
        'Empresa Oficial da Receita',
      );
    });

    it('só a Filial diverge da Receita → só 1 PUT (na Filial)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest
          .fn()
          .mockResolvedValue({ codigo: '20', nome: 'Empresa Filial Errado' }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      // Matriz já bate com a Receita ("Empresa Matriz"), só a Filial está errada.
      const companies = companiesMock({ razaoSocial: 'Empresa Matriz' });
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        companies,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const resultado = await service.aplicarCorrecaoSefazNoEgestor(linha());

      expect(auth.getAccessToken).toHaveBeenCalledTimes(1);
      expect(auth.getAccessToken).toHaveBeenCalledWith('filial');
      expect(http.put).toHaveBeenCalledTimes(1);
      expect((http.put as jest.Mock).mock.calls[0][1]).toBe('/v1/contatos/20');
      expect((http.put as jest.Mock).mock.calls[0][2]).toMatchObject({
        nome: 'Empresa Matriz',
      });
      expect(resultado.camposConsolidados).toEqual(['nome']);
      expect(resultado.dadosFilialAtualizados.nome).toBe('Empresa Matriz');
      // Matriz não foi tocada.
      expect(resultado.dadosMatrizAtualizados).toEqual(linha().dadosMatriz);
    });

    it('os dois lados divergem da Receita → 2 PUT (Matriz e Filial)', async () => {
      const auth = {
        getAccessToken: jest
          .fn()
          .mockImplementation((estabelecimento: string) =>
            Promise.resolve(`token-${estabelecimento}`),
          ),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest
          .fn()
          .mockImplementation((_token: string, path: string) =>
            Promise.resolve(
              path.endsWith('/10') ? { codigo: '10' } : { codigo: '20' },
            ),
          ),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      // Receita diverge dos dois lados ("Empresa Matriz" e "Empresa Filial Errado").
      const companies = companiesMock({
        razaoSocial: 'Empresa Oficial Receita',
      });
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        companies,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const resultado = await service.aplicarCorrecaoSefazNoEgestor(
        linha({ camposDiferentes: ['nome'] }),
      );

      expect(http.put).toHaveBeenCalledTimes(2);
      const [putMatriz, putFilial] = (http.put as jest.Mock).mock.calls;
      expect(putMatriz[1]).toBe('/v1/contatos/10');
      expect(putMatriz[2]).toMatchObject({ nome: 'Empresa Oficial Receita' });
      expect(putFilial[1]).toBe('/v1/contatos/20');
      expect(putFilial[2]).toMatchObject({ nome: 'Empresa Oficial Receita' });
      expect(resultado.camposConsolidados).toEqual(['nome']);
      expect(resultado.dadosMatrizAtualizados.nome).toBe(
        'Empresa Oficial Receita',
      );
      expect(resultado.dadosFilialAtualizados.nome).toBe(
        'Empresa Oficial Receita',
      );
    });

    it('nunca usa e-mail/telefone da Receita como fonte (fora de CAMPOS_SEFAZ)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('t'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest.fn().mockResolvedValue({ codigo: '20' }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const companies = companiesMock({
        razaoSocial: 'Empresa Oficial',
        emails: ['contador@escritorio.com.br'],
      } as never);
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        companies,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const row = linha({ camposDiferentes: ['nome', 'emails'] });
      const resultado = await service.aplicarCorrecaoSefazNoEgestor(row);

      // "emails" não é campo SEFAZ — mesmo divergente, fica de fora e o
      // e-mail da Receita nunca aparece no payload nem no resultado.
      expect(resultado.camposConsolidados).toEqual(['nome']);
      expect((http.put as jest.Mock).mock.calls[0][2]).not.toHaveProperty(
        'emails',
      );
    });
  });

  describe('Corrigir com CRM (aplicarCorrecaoCrmNoEgestor)', () => {
    it('lança BadRequestException quando não há Company com esse CNPJ (crm null)', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await expect(
        service.aplicarCorrecaoCrmNoEgestor(linha(), null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lança BadRequestException quando o CRM não traz valor útil pra nenhum campo divergente', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      await expect(
        service.aplicarCorrecaoCrmNoEgestor(linha(), crm()), // sem razaoSocial/logradouro etc.
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('só a Filial diverge do CRM → só 1 PUT (na Filial)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest
          .fn()
          .mockResolvedValue({ codigo: '20', nome: 'Empresa Filial Errado' }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      // Matriz já bate com o CRM ("Empresa Matriz"), só a Filial está errada.
      const resultado = await service.aplicarCorrecaoCrmNoEgestor(
        linha(),
        crm({ razaoSocial: 'Empresa Matriz' }),
      );

      expect(auth.getAccessToken).toHaveBeenCalledTimes(1);
      expect(auth.getAccessToken).toHaveBeenCalledWith('filial');
      expect(http.put).toHaveBeenCalledTimes(1);
      expect((http.put as jest.Mock).mock.calls[0][1]).toBe('/v1/contatos/20');
      expect((http.put as jest.Mock).mock.calls[0][2]).toMatchObject({
        nome: 'Empresa Matriz',
      });
      expect(resultado.camposConsolidados).toEqual(['nome']);
      expect(resultado.dadosFilialAtualizados.nome).toBe('Empresa Matriz');
      expect(resultado.dadosMatrizAtualizados).toEqual(linha().dadosMatriz);
    });

    it('os dois lados divergem do CRM → 2 PUT (Matriz e Filial)', async () => {
      const auth = {
        getAccessToken: jest
          .fn()
          .mockImplementation((estabelecimento: string) =>
            Promise.resolve(`token-${estabelecimento}`),
          ),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest
          .fn()
          .mockImplementation((_token: string, path: string) =>
            Promise.resolve(
              path.endsWith('/10') ? { codigo: '10' } : { codigo: '20' },
            ),
          ),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const resultado = await service.aplicarCorrecaoCrmNoEgestor(
        linha({ camposDiferentes: ['nome'] }),
        crm({ razaoSocial: 'Empresa Oficial do CRM' }),
      );

      expect(http.put).toHaveBeenCalledTimes(2);
      const [putMatriz, putFilial] = (http.put as jest.Mock).mock.calls;
      expect(putMatriz[1]).toBe('/v1/contatos/10');
      expect(putMatriz[2]).toMatchObject({ nome: 'Empresa Oficial do CRM' });
      expect(putFilial[1]).toBe('/v1/contatos/20');
      expect(putFilial[2]).toMatchObject({ nome: 'Empresa Oficial do CRM' });
      expect(resultado.camposConsolidados).toEqual(['nome']);
      expect(resultado.dadosMatrizAtualizados.nome).toBe(
        'Empresa Oficial do CRM',
      );
      expect(resultado.dadosFilialAtualizados.nome).toBe(
        'Empresa Oficial do CRM',
      );
    });

    it('detecta e corrige quando Matriz e Filial JÁ SÃO IGUAIS entre si mas os dois divergem do CRM (status ambos_iguais, campo fora de camposDiferentes) — pedido do usuário 2026-08-14', async () => {
      const auth = {
        getAccessToken: jest
          .fn()
          .mockImplementation((estabelecimento: string) =>
            Promise.resolve(`token-${estabelecimento}`),
          ),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest
          .fn()
          .mockImplementation((_token: string, path: string) =>
            Promise.resolve(
              path.endsWith('/10') ? { codigo: '10' } : { codigo: '20' },
            ),
          ),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const row = linha({
        status: EgestorContatoStatus.ambos_iguais,
        camposDiferentes: [],
        dadosMatriz: { codigo: 10, nome: 'Empresa Desatualizada' },
        dadosFilial: { codigo: 20, nome: 'Empresa Desatualizada' },
      });

      const resultado = await service.aplicarCorrecaoCrmNoEgestor(
        row,
        crm({ razaoSocial: 'Empresa Oficial do CRM' }),
      );

      expect(http.put).toHaveBeenCalledTimes(2);
      expect(resultado.camposConsolidados).toEqual(['nome']);
      expect(resultado.dadosMatrizAtualizados.nome).toBe(
        'Empresa Oficial do CRM',
      );
      expect(resultado.dadosFilialAtualizados.nome).toBe(
        'Empresa Oficial do CRM',
      );
    });
  });

  // Regressão do bug relatado 3x pelo usuário (2026-08-14): a coluna "CRM"
  // aparecia "—" em campo que o CRM tinha preenchido, porque o mapa só
  // cobria razão social/fantasia/endereço.
  describe('cobertura de campos do CRM (CAMPOS_CRM_ESCRITA)', () => {
    it('nomeParaContato entra na correção (estava faltando no mapa — caso real relatado)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest.fn().mockResolvedValue({ codigo: '20' }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const row = linha({
        camposDiferentes: ['nomeParaContato'],
        dadosMatriz: {
          codigo: 10,
          nomeParaContato: 'CONTATO EXEMPLO- COMPRADORA',
        },
        dadosFilial: { codigo: 20, nomeParaContato: null },
      });

      const resultado = await service.aplicarCorrecaoCrmNoEgestor(
        row,
        crm({ nomeParaContato: 'CONTATO EXEMPLO- COMPRADORA' }),
      );

      // Matriz já bate com o CRM; só a Filial (vazia) é corrigida.
      expect(resultado.camposConsolidados).toEqual(['nomeParaContato']);
      expect((http.put as jest.Mock).mock.calls[0][2]).toMatchObject({
        nomeParaContato: 'CONTATO EXEMPLO- COMPRADORA',
      });
    });

    it('NUNCA grava emails/fones do CRM (lista — sobrescrever apagaria o que só existe no eGestor; usar "Consolidar")', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const row = linha({
        camposDiferentes: ['emails', 'fones'],
        dadosMatriz: { codigo: 10, emails: ['a@x.com'], fones: ['111'] },
        dadosFilial: { codigo: 20, emails: ['b@x.com'], fones: ['222'] },
      });

      // CRM tem e-mail/telefone, mas eles não podem virar escrita.
      await expect(
        service.aplicarCorrecaoCrmNoEgestor(
          row,
          crm({ emails: ['farenzena@exemplo.com.br'], fones: ['495360159'] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('NUNCA grava cidade (o eGestor deriva do codIBGE e rejeita com 422)', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const row = linha({
        camposDiferentes: ['cidade'],
        dadosMatriz: { codigo: 10, cidade: 'OUTRA CIDADE' },
        dadosFilial: { codigo: 20, cidade: 'OUTRA CIDADE' },
      });

      await expect(
        service.aplicarCorrecaoCrmNoEgestor(
          row,
          crm({ cidade: 'SALTO VELOSO' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('inscricaoEstadual entra quando o CRM tem (customFields.inscricao_estadual)', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const http = {
        getOne: jest.fn().mockResolvedValue({ codigo: '20' }),
        put: jest.fn().mockResolvedValue({}),
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const row = linha({
        camposDiferentes: ['inscricaoEstadual'],
        dadosMatriz: { codigo: 10, inscricaoEstadual: '111222333' },
        dadosFilial: { codigo: 20, inscricaoEstadual: null },
      });

      const resultado = await service.aplicarCorrecaoCrmNoEgestor(
        row,
        crm({ inscricaoEstadual: '111222333' }),
      );

      expect(resultado.camposConsolidados).toEqual(['inscricaoEstadual']);
    });

    // Lacuna achada pelo usuário em 2026-08-17: a linha divergia só em
    // fantasia/indicadorIE/inscricaoEstadual e a coluna "CRM" da tela
    // ficava inteira em branco, sem nenhuma opção utilizável — indicadorIE
    // não estava em CAMPOS_CRM_ESCRITA, então o CRM nunca opinava sobre
    // ele mesmo tendo o dado ("Contribuinte de ICMS" + Inscrição Estadual
    // na aba Dados cadastrais). O valor sai como NÚMERO no payload: a doc
    // oficial trata indicadorIE como enum numérico (1/2/9).
    it('indicadorIE entra pelo bloco estadual do CRM e vai como número', async () => {
      const auth = {
        getAccessToken: jest.fn().mockResolvedValue('token-filial'),
      } as unknown as EgestorAuthService;
      const put = jest.fn().mockResolvedValue({});
      const http = {
        getOne: jest.fn().mockResolvedValue({ codigo: '20' }),
        put,
      } as unknown as EgestorHttpService;
      const service = new EgestorContatoCorrectionService(
        auth,
        http,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );

      const row = linha({
        camposDiferentes: ['indicadorIE'],
        dadosMatriz: { codigo: 10, indicadorIE: 1 },
        dadosFilial: { codigo: 20, indicadorIE: 9 },
      });

      const resultado = await service.aplicarCorrecaoCrmNoEgestor(
        row,
        crm({ indicadorIE: '1' }),
      );

      expect(resultado.camposConsolidados).toEqual(['indicadorIE']);
      expect(put).toHaveBeenCalledTimes(1);
      expect(put.mock.calls[0][2]).toMatchObject({ indicadorIE: 1 });
    });
  });

  // Propagação disparada ao salvar a ficha da empresa (2026-08-14). O que
  // distingue este caminho dos outros: nada aqui pode LANÇAR por "não dá
  // pra propagar" — a ficha já salvou antes de chamar, e um erro faria
  // parecer que o save falhou. Todo caso ruim volta como { ok: false }.
  // O eco morava nos CHAMADORES até 2026-08-14 (7 pontos espalhados) —
  // todos corretos, mas nada obrigava o próximo caminho de escrita a
  // lembrar. Um caminho sem eco faz o CRM tratar a própria escrita como
  // mudança externa e reescrever de volta; com normalização assimétrica
  // do outro lado, isso vira looping até estourar o rate limit do eGestor.
  // Estes testes travam a garantia: quem persiste, registra.
  describe('eco é registrado pelo próprio persistir* (não pelo chamador)', () => {
    function criarTxUpdate() {
      return {
        egestorContatoConsolidado: {
          update: jest.fn().mockResolvedValue(undefined),
        },
      } as unknown as import('../../tenancy/tenant-context.service').TenantTx;
    }

    it('persistirCorrecao registra o lado que recebeu o PUT', async () => {
      const echo = { registrar: jest.fn() };
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        echo as unknown as EgestorWebhookEchoService,
      );

      await service.persistirCorrecao(
        criarTxUpdate(),
        'row-1',
        'ws-1',
        'matriz_para_filial',
        {
          camposCorrigidos: ['nome'],
          dadosDestinoAtualizados: { codigo: 20, nome: 'NOVO' },
          estabelecimentoEscrito: 'filial',
          codigoEscrito: '20',
        },
      );

      expect(echo.registrar).toHaveBeenCalledWith(expect.anything(), 'ws-1', [
        { estabelecimento: 'filial', codigo: '20' },
      ]);
    });

    it('persistirConsolidacao registra TODOS os lados escritos', async () => {
      const echo = { registrar: jest.fn() };
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        echo as unknown as EgestorWebhookEchoService,
      );
      const codigosEscritos = [
        { estabelecimento: 'matriz' as const, codigo: '10' },
        { estabelecimento: 'filial' as const, codigo: '20' },
      ];

      await service.persistirConsolidacao(criarTxUpdate(), 'row-1', linha(), {
        camposConsolidados: ['nome'],
        dadosMatrizAtualizados: { codigo: 10, nome: 'NOVO' },
        dadosFilialAtualizados: { codigo: 20, nome: 'NOVO' },
        codigosEscritos,
      });

      expect(echo.registrar).toHaveBeenCalledWith(
        expect.anything(),
        'ws-1',
        codigosEscritos,
      );
    });

    it('persistirCompletar registra o código NOVO, não o que já existia', async () => {
      const echo = { registrar: jest.fn() };
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        echo as unknown as EgestorWebhookEchoService,
      );

      await service.persistirCompletar(
        criarTxUpdate(),
        'row-1',
        linha({ status: EgestorContatoStatus.so_matriz, codigoFilial: null }),
        {
          codigoNovo: '99',
          dadosNovo: { codigo: 99, nome: 'CRIADO AGORA' },
          estabelecimentoEscrito: 'filial',
        },
      );

      expect(echo.registrar).toHaveBeenCalledWith(expect.anything(), 'ws-1', [
        { estabelecimento: 'filial', codigo: '99' },
      ]);
    });
  });

  describe('buscarParaPropagacao (salvar a ficha da empresa)', () => {
    function criarTxComCrm(
      row: EgestorContatoConsolidado | null,
      linhasCrm: Array<Record<string, unknown>> = [],
    ) {
      return {
        egestorContatoConsolidado: {
          findFirst: jest.fn().mockResolvedValue(row),
        },
        $queryRaw: jest.fn().mockResolvedValue(linhasCrm),
      } as unknown as import('../../tenancy/tenant-context.service').TenantTx;
    }

    function service() {
      return new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
    }

    it('devolve ok:false (não lança) quando a empresa não tem vínculo com o eGestor', async () => {
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(null),
        'ws-1',
        'company-1',
      );

      expect(resultado).toEqual({
        ok: false,
        motivo: expect.stringContaining('sem vínculo'),
      });
    });

    it('devolve ok:false quando o contato só existe de um lado (é caso de "Completar")', async () => {
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(
          linha({
            status: EgestorContatoStatus.so_matriz,
            companyId: 'company-1',
          }),
        ),
        'ws-1',
        'company-1',
      );

      expect(resultado.ok).toBe(false);
    });

    it('devolve ok:false quando falta o código de um dos lados', async () => {
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(linha({ codigoFilial: null, companyId: 'company-1' })),
        'ws-1',
        'company-1',
      );

      expect(resultado.ok).toBe(false);
    });

    it('devolve a linha e o cadastro do CRM quando dá pra propagar', async () => {
      const row = linha({ companyId: 'company-1', cpfCnpj: '12345678000199' });
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(row, [
          {
            cnpj_digits: '12345678000199',
            razao_social: 'EMPRESA CERTA LTDA',
            inscricao_estadual: '111222333',
          },
        ]),
        'ws-1',
        'company-1',
      );

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.row.id).toBe(row.id);
      expect(resultado.crm?.inscricaoEstadual).toBe('111222333');
    });

    // Decisão do usuário (2026-08-17): o Indicador de IE é ESCOLHIDO na
    // ficha da empresa, nunca deduzido. Ter Inscrição Estadual não implica
    // mais indicadorIE=1 — sem a escolha explícita o CRM não opina, e o
    // campo fica de fora da correção do eGestor. É o que permite mexer só
    // nos cadastros divergentes, caso a caso, sem tocar nos 100% iguais.
    it('indicadorIE só sai do cadastro quando escolhido — IE preenchida sozinha não deduz nada', async () => {
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(
          linha({ companyId: 'company-1', cpfCnpj: '12345678000199' }),
          [
            {
              cnpj_digits: '12345678000199',
              inscricao_estadual: '111222333',
              indicador_ie: null,
            },
          ],
        ),
        'ws-1',
        'company-1',
      );

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.crm?.indicadorIE).toBeNull();
    });

    it('indicadorIE fora do enum 1/2/9 é descartado (customFields é jsonb livre)', async () => {
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(
          linha({ companyId: 'company-1', cpfCnpj: '12345678000199' }),
          [{ cnpj_digits: '12345678000199', indicador_ie: '0' }],
        ),
        'ws-1',
        'company-1',
      );

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.crm?.indicadorIE).toBeNull();
    });

    it('indicadorIE escolhido na ficha chega como o número do enum', async () => {
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(
          linha({ companyId: 'company-1', cpfCnpj: '12345678000199' }),
          [{ cnpj_digits: '12345678000199', indicador_ie: '2' }],
        ),
        'ws-1',
        'company-1',
      );

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.crm?.indicadorIE).toBe('2');
    });

    it('devolve ok:true com crm null quando não há Company com aquele CNPJ', async () => {
      const resultado = await service().buscarParaPropagacao(
        criarTxComCrm(
          linha({ companyId: 'company-1', cpfCnpj: '12345678000199' }),
          [],
        ),
        'ws-1',
        'company-1',
      );

      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.crm).toBeNull();
    });

    it('busca a linha do espelho pelo companyId, não pelo id do espelho', async () => {
      const tx = criarTxComCrm(linha({ companyId: 'company-1' }));

      await service().buscarParaPropagacao(tx, 'ws-1', 'company-1');

      expect(tx.egestorContatoConsolidado.findFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-1', workspaceId: 'ws-1' },
      });
    });
  });

  describe('buscarParaCorrecaoExterna (usado por Corrigir com SEFAZ/CRM)', () => {
    it('lança NotFoundException quando o registro não existe no workspace', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const tx = criarTx(null);

      await expect(
        service.buscarParaCorrecaoExterna(tx, 'ws-1', 'row-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException pra so_matriz/so_filial (falta um dos dois lados pra comparar)', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const tx = criarTx(
        linha({
          status: EgestorContatoStatus.so_matriz,
          dadosFilial: null,
          codigoFilial: null,
        }),
      );

      await expect(
        service.buscarParaCorrecaoExterna(tx, 'ws-1', 'row-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aceita status ambos_iguais (diferente de buscarParaCorrecao, que exige ambos_diferentes)', async () => {
      const service = new EgestorContatoCorrectionService(
        {} as EgestorAuthService,
        {} as EgestorHttpService,
        {} as CompanyService,
        { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
      );
      const row = linha({
        status: EgestorContatoStatus.ambos_iguais,
        camposDiferentes: [],
      });
      const tx = criarTx(row);

      await expect(
        service.buscarParaCorrecaoExterna(tx, 'ws-1', 'row-1'),
      ).resolves.toEqual(row);
    });
  });

  describe('calcularCrmCamposDivergentes (usado por listar() pra montar a coluna CRM)', () => {
    it('devolve [] pra so_matriz/so_filial (nada dos dois lados pra comparar)', () => {
      const row = linha({
        status: EgestorContatoStatus.so_matriz,
        dadosFilial: null,
      });
      expect(
        calcularCrmCamposDivergentes(row, crm({ razaoSocial: 'Empresa X' })),
      ).toEqual([]);
    });

    it('devolve [] quando não há Company com este CNPJ (crm null)', () => {
      const row = linha();
      expect(calcularCrmCamposDivergentes(row, null)).toEqual([]);
    });

    it('detecta divergência mesmo com Matriz e Filial iguais entre si (fora de camposDiferentes)', () => {
      const row = linha({
        status: EgestorContatoStatus.ambos_iguais,
        camposDiferentes: [],
        dadosMatriz: { codigo: 10, nome: 'Empresa Desatualizada' },
        dadosFilial: { codigo: 20, nome: 'Empresa Desatualizada' },
      });
      expect(
        calcularCrmCamposDivergentes(
          row,
          crm({ razaoSocial: 'Empresa Atual' }),
        ),
      ).toEqual(['nome']);
    });

    it('devolve [] quando Matriz, Filial e CRM já batem', () => {
      const row = linha({
        status: EgestorContatoStatus.ambos_iguais,
        camposDiferentes: [],
        dadosMatriz: { codigo: 10, nome: 'Empresa X' },
        dadosFilial: { codigo: 20, nome: 'Empresa X' },
      });
      expect(
        calcularCrmCamposDivergentes(row, crm({ razaoSocial: 'Empresa X' })),
      ).toEqual([]);
    });
  });

  describe('completar (Completar Matriz ⇄ Filial)', () => {
    describe('buscarParaCompletar', () => {
      it('lança BadRequestException quando o status já é ambos_diferentes/ambos_iguais', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const tx = criarTx(
          linha({ status: EgestorContatoStatus.ambos_iguais }),
        );

        await expect(
          service.buscarParaCompletar(tx, 'ws-1', 'row-1'),
        ).rejects.toThrow(BadRequestException);
      });

      it('devolve a linha quando so_matriz com dado de origem', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({
          status: EgestorContatoStatus.so_matriz,
          dadosFilial: null,
          codigoFilial: null,
        });
        const tx = criarTx(row);

        await expect(
          service.buscarParaCompletar(tx, 'ws-1', 'row-1'),
        ).resolves.toEqual(row);
      });
    });

    describe('completarNoEgestor', () => {
      it('so_matriz: pede token da Filial e cria lá com os dados da Matriz (sem codigo/dtCad/cidade)', async () => {
        const auth = {
          getAccessToken: jest.fn().mockResolvedValue('token-filial'),
        } as unknown as EgestorAuthService;
        const http = {
          post: jest
            .fn()
            .mockResolvedValue({ codigo: 99, nome: 'Empresa Matriz' }),
        } as unknown as EgestorHttpService;
        const service = new EgestorContatoCorrectionService(
          auth,
          http,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({
          status: EgestorContatoStatus.so_matriz,
          dadosFilial: null,
          codigoFilial: null,
          dadosMatriz: {
            codigo: 10,
            nome: 'Empresa Matriz',
            cidade: 'São Paulo',
            dtCad: '2020-01-01',
            logradouro: 'Rua Certa',
          },
        });

        const resultado = await service.completarNoEgestor(row);

        expect(auth.getAccessToken).toHaveBeenCalledWith('filial');
        expect(http.post).toHaveBeenCalledWith(
          'token-filial',
          '/v1/contatos',
          expect.objectContaining({
            nome: 'Empresa Matriz',
            logradouro: 'Rua Certa',
          }),
        );
        const payloadEnviado = (http.post as jest.Mock).mock.calls[0][2];
        expect(payloadEnviado).not.toHaveProperty('codigo');
        expect(payloadEnviado).not.toHaveProperty('dtCad');
        expect(payloadEnviado).not.toHaveProperty('cidade');
        expect(resultado).toEqual({
          codigoNovo: '99',
          dadosNovo: expect.objectContaining({
            codigo: 99,
            nome: 'Empresa Matriz',
          }),
          estabelecimentoEscrito: 'filial',
        });
      });

      it('so_filial: pede token da Matriz e cria lá', async () => {
        const auth = {
          getAccessToken: jest.fn().mockResolvedValue('token-matriz'),
        } as unknown as EgestorAuthService;
        const http = {
          post: jest.fn().mockResolvedValue({ codigo: 55 }),
        } as unknown as EgestorHttpService;
        const service = new EgestorContatoCorrectionService(
          auth,
          http,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({
          status: EgestorContatoStatus.so_filial,
          dadosMatriz: null,
          codigoMatriz: null,
          dadosFilial: { codigo: 20, nome: 'Empresa Filial' },
        });

        await service.completarNoEgestor(row);

        expect(auth.getAccessToken).toHaveBeenCalledWith('matriz');
        expect(http.post).toHaveBeenCalledWith(
          'token-matriz',
          '/v1/contatos',
          expect.objectContaining({ nome: 'Empresa Filial' }),
        );
      });

      it('converte indicadorIE: 0 pra 9 e emails/fones de objeto pra string simples', async () => {
        const auth = {
          getAccessToken: jest.fn().mockResolvedValue('token-filial'),
        } as unknown as EgestorAuthService;
        const http = {
          post: jest.fn().mockResolvedValue({ codigo: 1 }),
        } as unknown as EgestorHttpService;
        const service = new EgestorContatoCorrectionService(
          auth,
          http,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({
          status: EgestorContatoStatus.so_matriz,
          dadosFilial: null,
          codigoFilial: null,
          dadosMatriz: {
            codigo: 10,
            nome: 'Empresa Matriz',
            indicadorIE: 0,
            emails: [{ email: 'contato@exemplo.com.br' }],
            fones: [{ telefone: '11999999999' }],
          },
        });

        await service.completarNoEgestor(row);

        const payloadEnviado = (http.post as jest.Mock).mock.calls[0][2];
        expect(payloadEnviado.indicadorIE).toBe(9);
        expect(payloadEnviado.emails).toEqual(['contato@exemplo.com.br']);
        expect(payloadEnviado.fones).toEqual(['11999999999']);
      });
    });

    describe('persistirCompletar', () => {
      it('so_matriz: grava codigoFilial/dadosFilial/nomeFilial', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({ status: EgestorContatoStatus.so_matriz });
        const tx = criarTx(row);

        const resultado = await service.persistirCompletar(tx, 'row-1', row, {
          codigoNovo: '99',
          dadosNovo: { codigo: 99, nome: 'Empresa Matriz' },
          estabelecimentoEscrito: 'filial',
        });

        expect(resultado).toEqual({
          statusFinal: EgestorContatoStatus.ambos_iguais,
        });
        const updateArg = (tx.egestorContatoConsolidado.update as jest.Mock)
          .mock.calls[0][0];
        expect(updateArg.data.status).toBe(EgestorContatoStatus.ambos_iguais);
        expect(updateArg.data.camposDiferentes).toEqual([]);
        expect(updateArg.data.codigoFilial).toBe('99');
        expect(updateArg.data.nomeFilial).toBe('Empresa Matriz');
        expect(updateArg.data.codigoMatriz).toBeUndefined();
      });

      it('so_filial: grava codigoMatriz/dadosMatriz/nomeMatriz', async () => {
        const service = new EgestorContatoCorrectionService(
          {} as EgestorAuthService,
          {} as EgestorHttpService,
          {} as CompanyService,
          { registrar: jest.fn() } as unknown as EgestorWebhookEchoService,
        );
        const row = linha({ status: EgestorContatoStatus.so_filial });
        const tx = criarTx(row);

        const updateArg = await service
          .persistirCompletar(tx, 'row-1', row, {
            codigoNovo: '77',
            dadosNovo: { codigo: 77, nome: 'Empresa Filial' },
            estabelecimentoEscrito: 'matriz',
          })
          .then(
            () =>
              (tx.egestorContatoConsolidado.update as jest.Mock).mock
                .calls[0][0],
          );

        expect(updateArg.data.codigoMatriz).toBe('77');
        expect(updateArg.data.nomeMatriz).toBe('Empresa Filial');
        expect(updateArg.data.codigoFilial).toBeUndefined();
      });
    });
  });
});
