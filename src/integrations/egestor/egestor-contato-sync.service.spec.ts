import type { CompanyService } from '../../companies/company.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import type { EgestorAuthService } from './egestor-auth.service';
import type { EgestorHttpService } from './egestor-http.service';
import {
  EgestorContatoSyncService,
  type ConsolidatedContatoRow,
} from './egestor-contato-sync.service';
import type { EgestorContatoRaw } from './egestor.types';

const membership: MembershipContext = {
  id: 'membership-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'owner',
  status: 'active',
};

// Contato mínimo válido — sobrescreve só o que o teste precisa.
function contato(
  overrides: Partial<EgestorContatoRaw> & { codigo: number },
): EgestorContatoRaw {
  return {
    nome: 'Empresa Fictícia LTDA',
    tipo: ['cliente'],
    cpfcnpj: '11111111000100',
    ...overrides,
  };
}

// `auth`/`http` mockados — o service só chama `getAccessToken` (devolve
// um token diferente por estabelecimento, pra `getAllPages` saber qual
// fixture devolver) e `getAllPages` (devolve os dois lados por token).
function criarService(
  matriz: EgestorContatoRaw[],
  filial: EgestorContatoRaw[],
  companies: Partial<CompanyService> = {},
): EgestorContatoSyncService {
  const auth = {
    getAccessToken: jest.fn((estabelecimento: 'matriz' | 'filial') =>
      Promise.resolve(
        estabelecimento === 'matriz' ? 'token-matriz' : 'token-filial',
      ),
    ),
  } as unknown as EgestorAuthService;

  const http = {
    getAllPages: jest.fn((accessToken: string) => {
      if (accessToken === 'token-matriz') return Promise.resolve(matriz);
      if (accessToken === 'token-filial') return Promise.resolve(filial);
      return Promise.resolve([]);
    }),
  } as unknown as EgestorHttpService;

  const companyService = {
    remove: jest.fn().mockResolvedValue({}),
    ...companies,
  } as unknown as CompanyService;

  return new EgestorContatoSyncService(auth, http, companyService);
}

function linhaPorCnpj(
  rows: ConsolidatedContatoRow[],
  cnpj: string,
): ConsolidatedContatoRow {
  const linha = rows.find((r) => r.cpfCnpj === cnpj);
  if (!linha)
    throw new Error(
      `Linha não encontrada pro CNPJ ${cnpj} — rows: ${JSON.stringify(rows)}`,
    );
  return linha;
}

describe('EgestorContatoSyncService', () => {
  describe('fetchConsolidated — classificação', () => {
    it('classifica so_matriz quando o CNPJ só existe na Matriz', async () => {
      const service = criarService(
        [contato({ codigo: 1, cpfcnpj: '11111111000100', nome: 'Só Matriz' })],
        [],
      );

      const { rows } = await service.fetchConsolidated();

      const linha = linhaPorCnpj(rows, '11111111000100');
      expect(linha.status).toBe('so_matriz');
      expect(linha.codigoMatriz).toBe('1');
      expect(linha.codigoFilial).toBeNull();
      expect(linha.nomeMatriz).toBe('Só Matriz');
      expect(linha.nomeFilial).toBeNull();
      expect(linha.dadosFilial).toBeNull();
    });

    it('classifica so_filial quando o CNPJ só existe na Filial', async () => {
      const service = criarService(
        [],
        [contato({ codigo: 9, cpfcnpj: '22222222000100', nome: 'Só Filial' })],
      );

      const { rows } = await service.fetchConsolidated();

      const linha = linhaPorCnpj(rows, '22222222000100');
      expect(linha.status).toBe('so_filial');
      expect(linha.codigoFilial).toBe('9');
      expect(linha.codigoMatriz).toBeNull();
      expect(linha.dadosMatriz).toBeNull();
    });

    it('classifica ambos_iguais quando os dois lados batem (ignorando codigo/dtCad/cidade)', async () => {
      const service = criarService(
        [
          contato({
            codigo: 1,
            cpfcnpj: '33333333000100',
            nome: 'Igual dos Dois Lados',
            cidade: 'Porto Alegre',
            dtCad: '2024-01-01',
          }),
        ],
        [
          contato({
            codigo: 50, // codigo diferente — não conta como divergência
            cpfcnpj: '33333333000100',
            nome: 'Igual dos Dois Lados',
            cidade: 'Caxias do Sul', // cidade diferente — não conta
            dtCad: '2024-06-15', // dtCad diferente — não conta
          }),
        ],
      );

      const { rows } = await service.fetchConsolidated();

      const linha = linhaPorCnpj(rows, '33333333000100');
      expect(linha.status).toBe('ambos_iguais');
      expect(linha.camposDiferentes).toEqual([]);
    });

    it('classifica ambos_diferentes e lista só os campos que realmente divergem', async () => {
      const service = criarService(
        [
          contato({
            codigo: 1,
            cpfcnpj: '44444444000100',
            nome: 'Divergente LTDA',
            emails: ['matriz@empresa.com'],
            cidade: 'Porto Alegre', // ignorado na comparação
          }),
        ],
        [
          contato({
            codigo: 7,
            cpfcnpj: '44444444000100',
            nome: 'Divergente LTDA',
            emails: ['filial@empresa.com'],
            cidade: 'Caxias do Sul', // ignorado na comparação
          }),
        ],
      );

      const { rows } = await service.fetchConsolidated();

      const linha = linhaPorCnpj(rows, '44444444000100');
      expect(linha.status).toBe('ambos_diferentes');
      expect(linha.camposDiferentes).toEqual(['emails']);
      // Matriz é o registro determinante quando há divergência (decisão
      // 1.15, docs/roadmap.md) — dadosMatriz continua
      // disponível pra quem for promover (EgestorContatoPromoteService).
      expect(linha.dadosMatriz?.emails).toEqual(['matriz@empresa.com']);
    });

    it('filtra contato só-fornecedor (sem "cliente" no array tipo)', async () => {
      const service = criarService(
        [
          contato({
            codigo: 1,
            cpfcnpj: '55555555000100',
            tipo: ['fornecedor'],
          }),
        ],
        [],
      );

      const { rows, clientesMatriz } = await service.fetchConsolidated();

      expect(rows).toHaveLength(0);
      expect(clientesMatriz).toBe(0);
    });

    it('mantém contato que é cliente E fornecedor ao mesmo tempo', async () => {
      const service = criarService(
        [
          contato({
            codigo: 1,
            cpfcnpj: '66666666000100',
            tipo: ['cliente', 'fornecedor'],
          }),
        ],
        [],
      );

      const { rows } = await service.fetchConsolidated();

      expect(linhaPorCnpj(rows, '66666666000100').status).toBe('so_matriz');
    });

    it('ignora contato sem CNPJ e conta em semCnpjIgnorados, sem gerar linha', async () => {
      const service = criarService(
        [
          contato({ codigo: 1, cpfcnpj: '' }),
          contato({ codigo: 2, cpfcnpj: '77777777000100' }),
        ],
        [],
      );

      const { rows, semCnpjIgnorados } = await service.fetchConsolidated();

      expect(rows).toHaveLength(1);
      expect(semCnpjIgnorados).toBe(1);
    });

    it('resumo bate: total (bruto) inclui fornecedor, clientes só conta quem entrou', async () => {
      const service = criarService(
        [
          contato({ codigo: 1, cpfcnpj: '88888888000100', tipo: ['cliente'] }),
          contato({
            codigo: 2,
            cpfcnpj: '99999999000100',
            tipo: ['fornecedor'],
          }),
        ],
        [contato({ codigo: 3, cpfcnpj: '10101010000100', tipo: ['cliente'] })],
      );

      const result = await service.fetchConsolidated();

      expect(result.totalMatriz).toBe(2);
      expect(result.clientesMatriz).toBe(1);
      expect(result.totalFilial).toBe(1);
      expect(result.clientesFilial).toBe(1);
    });
  });

  describe('persist', () => {
    it('faz upsert de cada linha por (workspaceId, cpfCnpj) e soma o resumo por status', async () => {
      const service = criarService([], []);
      const upsert = jest.fn().mockResolvedValue({});
      const findMany = jest.fn().mockResolvedValue([]); // sem órfãs
      const tx = {
        egestorContatoConsolidado: { upsert, findMany },
      } as unknown as Parameters<typeof service.persist>[0];

      const rows: ConsolidatedContatoRow[] = [
        {
          cpfCnpj: '1',
          status: 'so_matriz',
          codigoMatriz: '1',
          codigoFilial: null,
          nomeMatriz: 'A',
          nomeFilial: null,
          dadosMatriz: contato({ codigo: 1 }),
          dadosFilial: null,
          camposDiferentes: [],
        },
        {
          cpfCnpj: '2',
          status: 'so_filial',
          codigoMatriz: null,
          codigoFilial: '2',
          nomeMatriz: null,
          nomeFilial: 'B',
          dadosMatriz: null,
          dadosFilial: contato({ codigo: 2 }),
          camposDiferentes: [],
        },
        {
          cpfCnpj: '3',
          status: 'ambos_iguais',
          codigoMatriz: '3',
          codigoFilial: '4',
          nomeMatriz: 'C',
          nomeFilial: 'C',
          dadosMatriz: contato({ codigo: 3 }),
          dadosFilial: contato({ codigo: 4 }),
          camposDiferentes: [],
        },
        {
          cpfCnpj: '4',
          status: 'ambos_diferentes',
          codigoMatriz: '5',
          codigoFilial: '6',
          nomeMatriz: 'D',
          nomeFilial: 'D',
          dadosMatriz: contato({ codigo: 5 }),
          dadosFilial: contato({ codigo: 6 }),
          camposDiferentes: ['emails'],
        },
      ];

      const summary = await service.persist(tx, membership, rows);

      expect(upsert).toHaveBeenCalledTimes(4);
      expect(upsert.mock.calls[0][0].where).toEqual({
        workspaceId_cpfCnpj: { workspaceId: 'workspace-1', cpfCnpj: '1' },
      });
      expect(summary).toEqual({
        total: 4,
        soMatriz: 1,
        soFilial: 1,
        ambosIguais: 1,
        ambosDiferentes: 1,
        orfasRemovidas: 0,
        companiesDesativadas: 0,
        errosDesativacao: [],
      });
    });
  });

  describe('persist — reconciliação de órfãs (contato deixou de ser cliente)', () => {
    // Cenário real (2026-08-12): contato ficava marcado "Cliente" por
    // engano no eGestor, foi promovido a Company, depois alguém corrigiu
    // o tipo (desmarcou "Cliente" nas duas contas) — a linha do espelho
    // e a Company promovida precisam parar de existir como cliente ativo.
    it('desativa (soft-delete) a Company de uma linha órfã com companyId e apaga a linha do espelho', async () => {
      const remove = jest.fn().mockResolvedValue({});
      const service = criarService([], [], { remove });
      const upsert = jest.fn().mockResolvedValue({});
      const del = jest.fn().mockResolvedValue({});
      const findMany = jest
        .fn()
        .mockResolvedValue([
          { id: 'mirror-1', cpfCnpj: '99999999000100', companyId: 'company-1' },
        ]);
      const tx = {
        egestorContatoConsolidado: { upsert, findMany, delete: del },
      } as unknown as Parameters<typeof service.persist>[0];

      // rows atuais não incluem mais o CNPJ '99999999000100' — caiu do
      // filtro "cliente" nas duas contas.
      const summary = await service.persist(tx, membership, []);

      expect(summary.orfasRemovidas).toBe(0); // rows vazio = trava de segurança, ver teste abaixo
      expect(remove).not.toHaveBeenCalled();
      expect(findMany).not.toHaveBeenCalled();
    });

    it('trava de segurança: rows vazio não reconcilia nada (evita desativar a carteira inteira por fetch vazio)', async () => {
      const remove = jest.fn().mockResolvedValue({});
      const service = criarService([], [], { remove });
      const findMany = jest.fn();
      const tx = {
        egestorContatoConsolidado: { upsert: jest.fn(), findMany },
      } as unknown as Parameters<typeof service.persist>[0];

      await service.persist(tx, membership, []);

      expect(findMany).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it('com rows não-vazio, encontra órfã (CNPJ fora do conjunto atual), desativa a Company e apaga a linha', async () => {
      const remove = jest.fn().mockResolvedValue({});
      const service = criarService([], [], { remove });
      const upsert = jest.fn().mockResolvedValue({});
      const del = jest.fn().mockResolvedValue({});
      const findMany = jest
        .fn()
        .mockResolvedValue([
          { id: 'mirror-1', cpfCnpj: '99999999000100', companyId: 'company-1' },
        ]);
      const tx = {
        egestorContatoConsolidado: { upsert, findMany, delete: del },
      } as unknown as Parameters<typeof service.persist>[0];

      const rowsAtuais: ConsolidatedContatoRow[] = [
        {
          cpfCnpj: '11111111000100', // outro CNPJ, ainda cliente
          status: 'so_matriz',
          codigoMatriz: '1',
          codigoFilial: null,
          nomeMatriz: 'Ainda Cliente',
          nomeFilial: null,
          dadosMatriz: contato({ codigo: 1 }),
          dadosFilial: null,
          camposDiferentes: [],
        },
      ];

      const summary = await service.persist(tx, membership, rowsAtuais);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-1',
          cpfCnpj: { notIn: ['11111111000100'] },
        },
        select: { id: true, cpfCnpj: true, companyId: true },
      });
      expect(remove).toHaveBeenCalledWith(tx, membership, 'company-1');
      expect(del).toHaveBeenCalledWith({ where: { id: 'mirror-1' } });
      expect(summary.companiesDesativadas).toBe(1);
      expect(summary.orfasRemovidas).toBe(1);
      expect(summary.errosDesativacao).toEqual([]);
    });

    it('órfã sem companyId (nunca promovida) só apaga a linha do espelho, sem chamar remove()', async () => {
      const remove = jest.fn().mockResolvedValue({});
      const service = criarService([], [], { remove });
      const del = jest.fn().mockResolvedValue({});
      const findMany = jest
        .fn()
        .mockResolvedValue([
          { id: 'mirror-2', cpfCnpj: '22222222000100', companyId: null },
        ]);
      const tx = {
        egestorContatoConsolidado: {
          upsert: jest.fn(),
          findMany,
          delete: del,
        },
      } as unknown as Parameters<typeof service.persist>[0];

      const summary = await service.persist(tx, membership, [
        {
          cpfCnpj: '33333333000100',
          status: 'so_matriz',
          codigoMatriz: '1',
          codigoFilial: null,
          nomeMatriz: 'X',
          nomeFilial: null,
          dadosMatriz: contato({ codigo: 1 }),
          dadosFilial: null,
          camposDiferentes: [],
        },
      ]);

      expect(remove).not.toHaveBeenCalled();
      expect(del).toHaveBeenCalledWith({ where: { id: 'mirror-2' } });
      expect(summary.companiesDesativadas).toBe(0);
      expect(summary.orfasRemovidas).toBe(1);
    });

    it('erro ao desativar uma órfã não derruba as outras — registra em errosDesativacao e segue', async () => {
      const remove = jest.fn().mockRejectedValue(new Error('sem permissão'));
      const service = criarService([], [], { remove });
      const del = jest.fn().mockResolvedValue({});
      const findMany = jest
        .fn()
        .mockResolvedValue([
          { id: 'mirror-3', cpfCnpj: '44444444000100', companyId: 'company-3' },
        ]);
      const tx = {
        egestorContatoConsolidado: {
          upsert: jest.fn(),
          findMany,
          delete: del,
        },
      } as unknown as Parameters<typeof service.persist>[0];

      const summary = await service.persist(tx, membership, [
        {
          cpfCnpj: '55555555000100',
          status: 'so_matriz',
          codigoMatriz: '1',
          codigoFilial: null,
          nomeMatriz: 'X',
          nomeFilial: null,
          dadosMatriz: contato({ codigo: 1 }),
          dadosFilial: null,
          camposDiferentes: [],
        },
      ]);

      expect(del).not.toHaveBeenCalled(); // não apaga a linha se a Company não pôde ser desativada
      expect(summary.errosDesativacao).toEqual([
        { cpfCnpj: '44444444000100', motivo: 'sem permissão' },
      ]);
      expect(summary.orfasRemovidas).toBe(0);
    });
  });

  // Métodos novos (2026-08-12) usados pelo processamento em tempo real do
  // webhook — processam UM contato só, combinando o lado que acabou de
  // mudar com o que já estava salvo do outro lado no espelho.
  describe('persistirContatoUnico', () => {
    it('combina o lado fresco (matriz) com o lado já salvo (filial) e detecta ambos_iguais', async () => {
      const service = criarService([], []);
      const upsert = jest.fn().mockResolvedValue({});
      const tx = {
        egestorContatoConsolidado: { upsert },
      } as unknown as Parameters<typeof service.persistirContatoUnico>[0];
      const mirrorExistente = {
        dadosFilial: contato({ codigo: 5, nome: 'Empresa X' }),
      };

      const row = await service.persistirContatoUnico(
        tx,
        'workspace-1',
        'matriz',
        '11111111000100',
        contato({ codigo: 10, nome: 'Empresa X' }),
        mirrorExistente as never,
      );

      expect(row.status).toBe('ambos_iguais');
      expect(row.codigoMatriz).toBe('10');
      expect(row.codigoFilial).toBe('5');
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId_cpfCnpj: {
              workspaceId: 'workspace-1',
              cpfCnpj: '11111111000100',
            },
          },
        }),
      );
    });

    it('detecta ambos_diferentes quando o lado fresco diverge do lado salvo', async () => {
      const service = criarService([], []);
      const upsert = jest.fn().mockResolvedValue({});
      const tx = {
        egestorContatoConsolidado: { upsert },
      } as unknown as Parameters<typeof service.persistirContatoUnico>[0];
      const mirrorExistente = {
        dadosFilial: contato({ codigo: 5, nome: 'Nome Antigo' }),
      };

      const row = await service.persistirContatoUnico(
        tx,
        'workspace-1',
        'matriz',
        '11111111000100',
        contato({ codigo: 10, nome: 'Nome Novo' }),
        mirrorExistente as never,
      );

      expect(row.status).toBe('ambos_diferentes');
      expect(row.camposDiferentes).toContain('nome');
    });

    it('sem mirror existente (contato novo) — status so_matriz, não busca o outro lado', async () => {
      const service = criarService([], []);
      const upsert = jest.fn().mockResolvedValue({});
      const tx = {
        egestorContatoConsolidado: { upsert },
      } as unknown as Parameters<typeof service.persistirContatoUnico>[0];

      const row = await service.persistirContatoUnico(
        tx,
        'workspace-1',
        'matriz',
        '11111111000100',
        contato({ codigo: 10 }),
        null,
      );

      expect(row.status).toBe('so_matriz');
      expect(row.dadosFilial).toBeNull();
    });
  });

  describe('reconciliarContatoUnico', () => {
    it('desativa a Company (soft-delete) e devolve desativouCompany: true', async () => {
      const remove = jest.fn().mockResolvedValue({});
      const service = criarService([], [], { remove });
      const del = jest.fn().mockResolvedValue({});
      const tx = {
        egestorContatoConsolidado: { delete: del },
      } as unknown as Parameters<typeof service.reconciliarContatoUnico>[0];
      const mirrorRow = {
        id: 'mirror-1',
        cpfCnpj: '11111111000100',
        companyId: 'company-1',
      };

      const resultado = await service.reconciliarContatoUnico(
        tx,
        membership,
        mirrorRow,
      );

      expect(remove).toHaveBeenCalledWith(tx, membership, 'company-1');
      expect(del).toHaveBeenCalledWith({ where: { id: 'mirror-1' } });
      expect(resultado).toEqual({ desativouCompany: true });
    });

    it('sem companyId — só apaga o espelho, desativouCompany: false', async () => {
      const remove = jest.fn().mockResolvedValue({});
      const service = criarService([], [], { remove });
      const del = jest.fn().mockResolvedValue({});
      const tx = {
        egestorContatoConsolidado: { delete: del },
      } as unknown as Parameters<typeof service.reconciliarContatoUnico>[0];
      const mirrorRow = {
        id: 'mirror-2',
        cpfCnpj: '22222222000100',
        companyId: null,
      };

      const resultado = await service.reconciliarContatoUnico(
        tx,
        membership,
        mirrorRow,
      );

      expect(remove).not.toHaveBeenCalled();
      expect(resultado).toEqual({ desativouCompany: false });
    });

    it('erro ao desativar — devolve o erro em vez de lançar', async () => {
      const remove = jest.fn().mockRejectedValue(new Error('sem permissão'));
      const service = criarService([], [], { remove });
      const tx = {
        egestorContatoConsolidado: { delete: jest.fn() },
      } as unknown as Parameters<typeof service.reconciliarContatoUnico>[0];
      const mirrorRow = {
        id: 'mirror-3',
        cpfCnpj: '33333333000100',
        companyId: 'company-3',
      };

      const resultado = await service.reconciliarContatoUnico(
        tx,
        membership,
        mirrorRow,
      );

      expect(resultado).toEqual({
        desativouCompany: false,
        erro: 'sem permissão',
      });
    });
  });
});
