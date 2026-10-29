import {
  FiscalNotasSyncService,
  dataDaLista,
  decimal,
  situacaoNfe,
  situacaoNfse,
} from './fiscal-notas-sync.service';

const XML_MINIMO = (n: number) => `<nfeProc><NFe><infNFe Id="NFe${'1'.repeat(44)}">
<ide><mod>55</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<det nItem="1"><prod><CFOP>5102</CFOP><vProd>100.00</vProd></prod><imposto></imposto></det>
<total><ICMSTot><vProd>100.00</vProd><vNF>100.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

describe('helpers da carga de notas emitidas', () => {
  it('lê a data do eGestor como horário de Brasília, guardando o dia local', () => {
    const r = dataDaLista('2026-09-30 22:15:00');
    expect(r.data).toBe('2026-09-30');
    expect(r.instante?.toISOString()).toBe('2026-10-01T01:15:00.000Z');
    expect(dataDaLista(null)).toEqual({ data: null, instante: null });
    expect(dataDaLista('lixo')).toEqual({ data: null, instante: null });
  });

  it('normaliza valor que vem como número ou texto, sem passar por float', () => {
    expect(decimal('1234.56')).toBe('1234.56');
    expect(decimal(10)).toBe('10');
    expect(decimal('1.234,56')).toBe('1234.56');
    expect(decimal('')).toBeNull();
    expect(decimal(null)).toBeNull();
    expect(decimal('abc')).toBeNull();
  });

  it('traduz a situação do eGestor', () => {
    expect(situacaoNfe(50)).toBe('autorizada');
    expect(situacaoNfe(90)).toBe('cancelada');
    expect(situacaoNfe(91)).toBe('inutilizada');
    expect(situacaoNfe(70)).toBe('pendente');
    expect(situacaoNfse(10)).toBe('autorizada');
    expect(situacaoNfse(25)).toBe('cancelamento_pendente');
    expect(situacaoNfse(90)).toBe('cancelada');
  });
});

describe('FiscalNotasSyncService.executar', () => {
  const ctx = {
    userId: '00000000-0000-4000-8000-000000000000',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    role: 'owner' as const,
  };

  function montar(opcoes: {
    nfeMatriz: { codigo: number; situacao: number; numero: number }[];
    recebidasMatriz?: { codigo: number; chave: string; situacao: number; temXML: string }[];
    jaGravadas?: { cod: number; situacao: number; tem_xml: boolean }[];
    diasSoResumoMatriz?: string[];
    xmlFalha?: number[];
    falhaGravacao?: number[];
  }) {
    const upserts: { codEgestor: number; temXml: boolean; situacao: string }[] = [];
    const itensCriados: number[] = [];
    const recebidasGravadas: string[] = [];
    const tx = {
      $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray, ...valores: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('FROM fiscal_nfe_emitida')) {
          return Promise.resolve(valores.includes('matriz') ? (opcoes.jaGravadas ?? []) : []);
        }
        if (sql.includes('to_char(data_emissao')) {
          return Promise.resolve(
            valores.includes('matriz') ? (opcoes.diasSoResumoMatriz ?? []).map((dia) => ({ dia })) : [],
          );
        }
        return Promise.resolve([]);
      }),
      fiscalNfeEmitida: {
        upsert: jest.fn().mockImplementation(({ create }: { create: { codEgestor: number; xml: string | null; situacao: string } }) => {
          if (opcoes.falhaGravacao?.includes(create.codEgestor)) {
            return Promise.reject(new Error('Transaction already closed'));
          }
          upserts.push({ codEgestor: create.codEgestor, temXml: create.xml !== null, situacao: create.situacao });
          return Promise.resolve({ id: `nfe-${create.codEgestor}` });
        }),
      },
      fiscalNfeEmitidaItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockImplementation(({ data }: { data: unknown[] }) => {
          itensCriados.push(data.length);
          return Promise.resolve({ count: data.length });
        }),
      },
      fiscalNfseEmitida: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ id: 'x' }),
      },
      fiscalNfeRecebida: {
        upsert: jest.fn().mockImplementation(({ create }: { create: { chave: string } }) => {
          recebidasGravadas.push(create.chave);
          return Promise.resolve({ id: `r-${create.chave}` });
        }),
      },
      fiscalNfeRecebidaItem: { deleteMany: jest.fn(), createMany: jest.fn() },
      egestorInteractionLog: { create: jest.fn() },
    };

    const http = {
      getAllPages: jest.fn().mockImplementation((_t: string, path: string) => {
        if (path === '/v1/nfe/recebidas') {
          return Promise.resolve(
            (http.getAllPages.mock.calls.filter((c) => c[1] === '/v1/nfe/recebidas').length === 1
              ? (opcoes.recebidasMatriz ?? [])
              : []
            ).map((n) => ({ ...n, tipo: 'nfe', ambiente: 1, dtEmissao: '2026-09-11 10:00:00' })),
          );
        }
        if (path === '/v1/nfe') {
          return Promise.resolve(
            (http.getAllPages.mock.calls.filter((c) => c[1] === '/v1/nfe').length === 1
              ? opcoes.nfeMatriz
              : []
            ).map((n) => ({ ...n, ambiente: 1, dtEmissao: '2026-09-10 10:00:00' })),
          );
        }
        return Promise.resolve([]);
      }),
      getText: jest.fn().mockImplementation((_t: string, path: string) => {
        const codigo = Number(/\/v1\/nfe\/(\d+)\/xml/.exec(path)?.[1]);
        if (opcoes.xmlFalha?.includes(codigo)) return Promise.reject(new Error('HTTP 500'));
        return Promise.resolve(XML_MINIMO(codigo));
      }),
      post: jest.fn().mockResolvedValue([]),
      getOne: jest.fn(),
    };
    const auth = { getAccessToken: jest.fn().mockResolvedValue('token') };
    const tenantContext = { run: jest.fn().mockImplementation((_c: unknown, fn: (t: typeof tx) => unknown) => fn(tx)) };
    const interactionLog = { registrar: jest.fn().mockResolvedValue(undefined) };

    const service = new FiscalNotasSyncService(
      auth as never,
      http as never,
      tenantContext as never,
      interactionLog as never,
      { registrar: jest.fn() } as never,
    );
    return { service, http, upserts, itensCriados, interactionLog, recebidasGravadas };
  }

  it('baixa o XML só de nota nova, que mudou de situação ou que ficou sem XML', async () => {
    const { service, http, upserts } = montar({
      nfeMatriz: [
        { codigo: 1, situacao: 50, numero: 101 }, // já gravada igual → pula
        { codigo: 2, situacao: 90, numero: 102 }, // era autorizada, foi cancelada → baixa
        { codigo: 3, situacao: 50, numero: 103 }, // gravada sem XML → baixa
        { codigo: 4, situacao: 50, numero: 104 }, // nova → baixa
        { codigo: 5, situacao: 91, numero: 105 }, // inutilizada nova → grava sem XML
      ],
      jaGravadas: [
        { cod: 1, situacao: 50, tem_xml: true },
        { cod: 2, situacao: 50, tem_xml: true },
        { cod: 3, situacao: 50, tem_xml: false },
      ],
    });

    const r = await service.executar(ctx, { desde: '2025-01-01', ate: '2026-10-20' });

    expect(http.getText.mock.calls.map((c) => c[1])).toEqual([
      '/v1/nfe/2/xml',
      '/v1/nfe/3/xml',
      '/v1/nfe/4/xml',
    ]);
    expect(upserts.map((u) => u.codEgestor)).toEqual([2, 3, 4, 5]);
    expect(upserts.find((u) => u.codEgestor === 5)).toEqual({ codEgestor: 5, temXml: false, situacao: 'inutilizada' });
    expect(r.porEstabelecimento.matriz).toMatchObject({ nfeListadas: 5, nfeGravadas: 4, nfeInalteradas: 1 });
    expect(r.falhas).toEqual([]);
  });

  it('nota cujo XML falha entra mesmo assim, sem XML, e é listada como falha', async () => {
    const { service, upserts, itensCriados } = montar({
      nfeMatriz: [
        { codigo: 7, situacao: 50, numero: 107 },
        { codigo: 8, situacao: 50, numero: 108 },
      ],
      xmlFalha: [7],
    });

    const r = await service.executar(ctx, { desde: '2025-01-01', ate: '2026-10-20' });

    expect(upserts).toEqual([
      { codEgestor: 7, temXml: false, situacao: 'autorizada' },
      { codEgestor: 8, temXml: true, situacao: 'autorizada' },
    ]);
    // Itens só da nota que teve XML.
    expect(itensCriados).toEqual([1]);
    expect(r.falhas).toEqual([
      expect.objectContaining({ estabelecimento: 'matriz', tipo: 'nfe', codEgestor: 7, numero: 107 }),
    ]);
  });

  it('pede ao eGestor até o dia seguinte, porque o dtFim dele não inclui o próprio dia', async () => {
    const { service, http } = montar({ nfeMatriz: [] });
    await service.executar(ctx, { desde: '2025-01-01', ate: '2026-10-20' });

    const chamadaNfe = http.getAllPages.mock.calls.find((c) => c[1] === '/v1/nfe');
    expect(chamadaNfe?.[2]).toMatchObject({ dtIni: '2025-01-01', dtFim: '2026-10-21' });
    expect(http.post).toHaveBeenCalledWith('token', '/v1/relatorios/nfseImpostos', {
      de: '2025-01-01',
      ate: '2026-10-21',
    });
  });

  it('carrega as NF-e recebidas válidas e descarta linha sem chave de 44 dígitos', async () => {
    const chave = '3526' + '1'.repeat(40);
    const { service, http, recebidasGravadas } = montar({
      nfeMatriz: [],
      recebidasMatriz: [
        { codigo: 20, chave, situacao: 1, temXML: '<?xml vers' },
        { codigo: 21, chave: '123', situacao: 1, temXML: '' },
      ],
    });

    const r = await service.executar(ctx, { desde: '2025-01-01', ate: '2026-10-20' });

    expect(recebidasGravadas).toEqual([chave]);
    expect(http.getText).toHaveBeenCalledWith('token', '/v1/nfe/recebidas/20/xml');
    expect(r.porEstabelecimento.matriz).toMatchObject({ recebidasListadas: 1, recebidasGravadas: 1 });
  });

  it('erro do banco numa nota vira falha dessa nota, e a carga segue com as outras', async () => {
    const { service, upserts } = montar({
      nfeMatriz: [
        { codigo: 1, situacao: 50, numero: 101 },
        { codigo: 2, situacao: 50, numero: 102 },
        { codigo: 3, situacao: 50, numero: 103 },
      ],
      falhaGravacao: [2],
    });

    const r = await service.executar(ctx, { desde: '2025-01-01', ate: '2026-10-20' });

    expect(upserts.map((u) => u.codEgestor)).toEqual([1, 3]);
    expect(r.porEstabelecimento.matriz).toMatchObject({ nfeGravadas: 2 });
    expect(r.falhas).toEqual([
      expect.objectContaining({ tipo: 'nfe', codEgestor: 2, motivo: expect.stringMatching(/erro ao gravar/) }),
    ]);
  });

  it('não roda duas cargas ao mesmo tempo', async () => {
    const { service } = montar({ nfeMatriz: [{ codigo: 1, situacao: 50, numero: 1 }] });
    const primeira = service.executar(ctx, { desde: '2025-01-01', ate: '2026-10-20' });
    await expect(service.executar(ctx, { desde: '2025-01-01' })).rejects.toThrow(/andamento/);
    await expect(service.conferirRecebidas(ctx, { desde: '2026-09-01' })).rejects.toThrow(/andamento/);
    await primeira;
    expect(service.status().emAndamento).toBe(false);
  });

  it('nota antiga ainda só em resumo é conferida de novo, um dia de cada vez', async () => {
    const { service, http } = montar({ nfeMatriz: [], diasSoResumoMatriz: ['2025-02-10', '2025-10-31'] });

    await service.executar(ctx, { desde: '2026-09-01', ate: '2026-10-21' });

    const periodos = http.getAllPages.mock.calls
      .filter((c) => c[1] === '/v1/nfe/recebidas')
      .map((c) => c[2]);
    expect(periodos).toEqual([
      // Matriz: o período, depois cada dia de nota só em resumo.
      { dtIni: '2026-09-01', dtFim: '2026-10-22' },
      { dtIni: '2025-02-10', dtFim: '2025-02-11' },
      { dtIni: '2025-10-31', dtFim: '2025-11-01' },
      // Filial: sem nota antiga só em resumo.
      { dtIni: '2026-09-01', dtFim: '2026-10-22' },
    ]);
  });

  it('conferência de hora em hora: só NF-e recebidas, sem mexer na última carga completa', async () => {
    const chave = '3526' + '2'.repeat(40);
    const { service, http, recebidasGravadas, interactionLog } = montar({
      nfeMatriz: [{ codigo: 1, situacao: 50, numero: 1 }],
      recebidasMatriz: [{ codigo: 30, chave, situacao: 1, temXML: '<?xml vers' }],
    });

    const r = await service.conferirRecebidas(ctx, { desde: '2026-09-01' });

    expect(http.getAllPages.mock.calls.map((c) => c[1])).toEqual(['/v1/nfe/recebidas', '/v1/nfe/recebidas']);
    expect(http.post).not.toHaveBeenCalled();
    expect(recebidasGravadas).toEqual([chave]);
    expect(r.porEstabelecimento.matriz).toMatchObject({ recebidasListadas: 1, recebidasGravadas: 1 });
    expect(interactionLog.registrar).toHaveBeenCalledWith(
      expect.anything(),
      ctx.workspaceId,
      expect.objectContaining({ action: 'conferir_nfe_recebidas' }),
    );
    expect(service.status()).toMatchObject({ emAndamento: false, ultima: null });
  });

  it('conferência de hora em hora sem novidade não entra no histórico', async () => {
    const { service, interactionLog } = montar({ nfeMatriz: [] });
    await service.conferirRecebidas(ctx, { desde: '2026-09-01' });
    expect(interactionLog.registrar).not.toHaveBeenCalled();
  });
});

describe('FiscalNotasSyncService.aplicarEventoNfe (webhook de NF-e)', () => {
  const ctx = {
    userId: '00000000-0000-4000-8000-000000000000',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    role: 'owner' as const,
  };

  function montar(opcoes: {
    detalhe?:
      | { codigo: number | string; situacao: number | string; numero?: number | string; modelo?: string }
      | 'nao_existe';
    jaExiste?: boolean;
    xml?: string;
  }) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      fiscalNfeEmitida: {
        findUnique: jest.fn().mockResolvedValue(opcoes.jaExiste ? { id: 'nfe-1' } : null),
        upsert: jest.fn().mockResolvedValue({ id: 'nfe-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: opcoes.jaExiste ? 1 : 0 }),
      },
      fiscalNfeEmitidaItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const http = {
      getOne: jest.fn().mockImplementation(() =>
        opcoes.detalhe === 'nao_existe'
          ? Promise.reject(new Error('Falha ao chamar eGestor GET /v1/nfe/9. HTTP 404: {}'))
          : Promise.resolve({ ...opcoes.detalhe, dt_emissao: '2026-10-21 09:00:00' }),
      ),
      getText: jest.fn().mockResolvedValue(opcoes.xml ?? XML_MINIMO(55)),
    };
    const registry = { registrar: jest.fn() };
    const service = new FiscalNotasSyncService(
      { getAccessToken: jest.fn().mockResolvedValue('token') } as never,
      http as never,
      { run: jest.fn().mockImplementation((_c: unknown, fn: (t: typeof tx) => unknown) => fn(tx)) } as never,
      { registrar: jest.fn() } as never,
      registry as never,
    );
    return { service, tx, http, registry };
  }

  it('se registra na ponte do webhook ao subir', () => {
    const { service, registry } = montar({});
    service.onModuleInit();
    expect(registry.registrar).toHaveBeenCalledWith(service);
  });

  it('nota autorizada nova: baixa o XML, grava com os itens e devolve "criada"', async () => {
    const { service, tx, http } = montar({ detalhe: { codigo: 9, situacao: 50, numero: 55 } });
    const r = await service.aplicarEventoNfe(ctx, 'matriz', '9', 'updated');

    expect(http.getText).toHaveBeenCalledWith('token', '/v1/nfe/9/xml');
    expect(tx.fiscalNfeEmitida.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ codEgestor: 9, situacao: 'autorizada', origem: 'egestor:/v1/nfe' }),
      }),
    );
    expect(tx.fiscalNfeEmitidaItem.createMany).toHaveBeenCalled();
    expect(r).toEqual({ resultado: 'nfe_criada', numero: 55, situacao: 'autorizada' });
  });

  it('detalhe com número, modelo e situação em texto (formato real do eGestor) grava como número', async () => {
    const { service, tx, http } = montar({
      detalhe: { codigo: '9', situacao: '50', numero: '1202', modelo: '55' },
      xml: XML_MINIMO(1202),
    });
    const r = await service.aplicarEventoNfe(ctx, 'matriz', '9', 'updated');

    expect(http.getText).toHaveBeenCalledWith('token', '/v1/nfe/9/xml');
    expect(tx.fiscalNfeEmitida.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ numero: 1202, modelo: 55, situacao: 'autorizada', situacaoEgestor: 50 }),
      }),
    );
    expect(r).toEqual({ resultado: 'nfe_criada', numero: 1202, situacao: 'autorizada' });
  });

  it('rascunho em texto, sem XML: número e situação saem convertidos', async () => {
    const { service, tx, http } = montar({ detalhe: { codigo: '9', situacao: '10', numero: '1203', modelo: '55' } });
    await service.aplicarEventoNfe(ctx, 'matriz', '9', 'created');

    expect(http.getText).not.toHaveBeenCalled();
    expect(tx.fiscalNfeEmitida.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ numero: 1203, modelo: 55, situacao: 'pendente', situacaoEgestor: 10 }),
      }),
    );
  });

  it('rascunho (sem XML no eGestor) entra só com o cabeçalho, sem pedir o arquivo', async () => {
    const { service, http } = montar({ detalhe: { codigo: 9, situacao: 10, numero: 56 }, jaExiste: true });
    const r = await service.aplicarEventoNfe(ctx, 'filial', '9', 'created');

    expect(http.getText).not.toHaveBeenCalled();
    expect(r).toEqual({ resultado: 'nfe_atualizada', numero: 56, situacao: 'pendente' });
  });

  it('nota excluída no eGestor (deleted ou 404) sai da tabela', async () => {
    const porDeleted = montar({ jaExiste: true });
    await expect(porDeleted.service.aplicarEventoNfe(ctx, 'matriz', '9', 'deleted')).resolves.toMatchObject({
      resultado: 'nfe_removida',
    });
    expect(porDeleted.http.getOne).not.toHaveBeenCalled();

    const por404 = montar({ detalhe: 'nao_existe' });
    await expect(por404.service.aplicarEventoNfe(ctx, 'matriz', '9', 'updated')).resolves.toMatchObject({
      resultado: 'nfe_inexistente_ignorada',
    });
  });

  it('nota de homologação é ignorada', async () => {
    const { service, tx } = montar({
      detalhe: { codigo: 9, situacao: 50, numero: 1 },
      xml: XML_MINIMO(1).replace('<ide>', '<ide><tpAmb>2</tpAmb>'),
    });
    const r = await service.aplicarEventoNfe(ctx, 'matriz', '9', 'updated');
    expect(r.resultado).toBe('nfe_homologacao_ignorada');
    expect(tx.fiscalNfeEmitida.upsert).not.toHaveBeenCalled();
  });

  it('erro de rede que não é 404 propaga (o eGestor reenvia o evento)', async () => {
    const { service, http } = montar({ detalhe: { codigo: 9, situacao: 50 } });
    http.getOne.mockRejectedValueOnce(new Error('Falha ao chamar eGestor GET /v1/nfe/9. HTTP 500: {}'));
    await expect(service.aplicarEventoNfe(ctx, 'matriz', '9', 'updated')).rejects.toThrow(/HTTP 500/);
  });
});
