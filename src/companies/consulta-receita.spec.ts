import { BadRequestException, NotFoundException } from '@nestjs/common';
import { consultarReceita, converterOpenCnpj } from './consulta-receita';

function resposta(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

describe('consultarReceita', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
  });

  it('usa a BrasilAPI quando ela responde', async () => {
    fetchMock.mockResolvedValueOnce(resposta(200, { razao_social: 'X' }));
    await expect(consultarReceita('00000000000191')).resolves.toEqual({
      razao_social: 'X',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cai pra OpenCNPJ quando a BrasilAPI dá 5xx', async () => {
    fetchMock
      .mockResolvedValueOnce(
        resposta(500, { message: 'Request failed with status code 503' }),
      )
      .mockResolvedValueOnce(
        resposta(200, { razao_social: 'X', situacao_cadastral: 'Ativa' }),
      );
    const data = await consultarReceita('00000000000191');
    expect(data.razao_social).toBe('X');
    expect(data.descricao_situacao_cadastral).toBe('ATIVA');
    expect((fetchMock.mock.calls as string[][])[1][0]).toContain(
      'api.opencnpj.org',
    );
  });

  it('cai pra OpenCNPJ quando a BrasilAPI dá erro de rede/timeout', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(resposta(200, { razao_social: 'X' }));
    await expect(consultarReceita('00000000000191')).resolves.toMatchObject({
      razao_social: 'X',
    });
  });

  it('CNPJ inválido na BrasilAPI volta a mensagem dela, sem reserva', async () => {
    fetchMock.mockResolvedValueOnce(
      resposta(400, { message: 'CNPJ 11.111.111/1111-11 inválido.' }),
    );
    await expect(consultarReceita('11111111111111')).rejects.toThrow(
      'CNPJ 11.111.111/1111-11 inválido.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('404 na BrasilAPI é "não encontrado", sem reserva', async () => {
    fetchMock.mockResolvedValueOnce(resposta(404, {}));
    await expect(consultarReceita('00000000000191')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('as duas fora do ar: mensagem em português, sem texto técnico', async () => {
    fetchMock
      .mockResolvedValueOnce(resposta(503, {}))
      .mockResolvedValueOnce(resposta(502, {}));
    const erro: unknown = await consultarReceita('00000000000191').catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as Error).message).toContain('fora do ar');
  });
});

describe('converterOpenCnpj', () => {
  it('converte pro formato da BrasilAPI', () => {
    const data = converterOpenCnpj({
      razao_social: 'EMPRESA TESTE LTDA',
      nome_fantasia: '',
      situacao_cadastral: 'Ativa',
      matriz_filial: 'Matriz',
      porte_empresa: 'Demais',
      tipo_logradouro: 'AVENIDA',
      logradouro: 'BRASIL',
      cnaes: [
        { codigo: '2815102', descricao: 'Principal', is_principal: true },
        { codigo: '4661300', descricao: 'Secundária', is_principal: false },
      ],
      telefones: [
        { ddd: '11', numero: '40000000', is_fax: true },
        { ddd: '11', numero: '30000000', is_fax: false },
      ],
    });
    expect(data).toMatchObject({
      nome_fantasia: undefined,
      descricao_situacao_cadastral: 'ATIVA',
      descricao_identificador_matriz_filial: 'MATRIZ',
      porte: 'DEMAIS',
      descricao_tipo_de_logradouro: 'AVENIDA',
      logradouro: 'BRASIL',
      cnae_fiscal: 2815102,
      cnae_fiscal_descricao: 'Principal',
      cnaes_secundarios: [{ codigo: 4661300, descricao: 'Secundária' }],
      ddd_telefone_1: '1130000000',
      ddd_telefone_2: undefined,
    });
  });
});
