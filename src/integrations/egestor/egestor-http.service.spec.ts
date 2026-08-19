import { InternalServerErrorException } from '@nestjs/common';
import { EgestorHttpService } from './egestor-http.service';

interface FakeContato {
  codigo: number;
}

function mockFetchOnce(status: number, body: unknown): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('EgestorHttpService', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    // Substitui o setTimeout real por uma versão síncrona — o throttle
    // (1.1s entre chamadas, ver comentário na classe) não precisa esperar
    // de verdade pra estes testes provarem a lógica de paginação. O
    // comportamento do throttle em si (que ele PEDE uma pausa) é testado
    // à parte, no describe('throttle') abaixo.
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('itera todas as páginas até passar de last_page, concatenando os dados', async () => {
    const http = new EgestorHttpService();
    mockFetchOnce(200, {
      data: [{ codigo: 1 }, { codigo: 2 }],
      last_page: 2,
      current_page: 1,
      total: 3,
      per_page: 2,
    });
    mockFetchOnce(200, {
      data: [{ codigo: 3 }],
      last_page: 2,
      current_page: 2,
      total: 3,
      per_page: 2,
    });

    const rows = await http.getAllPages<FakeContato>(
      'token-abc',
      '/v1/contatos',
      {
        fields: 'codigo',
      },
    );

    expect(rows).toEqual([{ codigo: 1 }, { codigo: 2 }, { codigo: 3 }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // 1ª e 2ª chamada pedem page=1 e page=2, nessa ordem.
    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) =>
      String(url),
    );
    expect(urls[0]).toContain('page=1');
    expect(urls[1]).toContain('page=2');
  });

  it('para na 1ª página quando last_page=1, sem chamar de novo', async () => {
    const http = new EgestorHttpService();
    mockFetchOnce(200, {
      data: [{ codigo: 1 }],
      last_page: 1,
      current_page: 1,
      total: 1,
      per_page: 50,
    });

    const rows = await http.getAllPages<FakeContato>(
      'token-abc',
      '/v1/contatos',
      {},
    );

    expect(rows).toEqual([{ codigo: 1 }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('respeita maxPages mesmo com last_page maior (teste de amostra, sem puxar tudo)', async () => {
    const http = new EgestorHttpService();
    mockFetchOnce(200, {
      data: [{ codigo: 1 }],
      last_page: 10,
      current_page: 1,
      total: 500,
      per_page: 50,
    });

    const rows = await http.getAllPages<FakeContato>(
      'token-abc',
      '/v1/contatos',
      {},
      { maxPages: 1 },
    );

    expect(rows).toEqual([{ codigo: 1 }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('lança erro quando a API responde HTTP não-2xx', async () => {
    const http = new EgestorHttpService();
    mockFetchOnce(401, { errCode: 401, errMsg: 'access_denied' });

    await expect(
      http.getAllPages<FakeContato>('token-invalido', '/v1/contatos', {}),
    ).rejects.toThrow(InternalServerErrorException);
  });

  describe('getOne', () => {
    it('devolve o corpo do GET quando a API responde 200', async () => {
      const http = new EgestorHttpService();
      mockFetchOnce(200, { codigo: '1', nome: 'Contato X' });

      const contato = await http.getOne<FakeContato & { nome: string }>(
        'token-abc',
        '/v1/contatos/1',
      );

      expect(contato).toEqual({ codigo: '1', nome: 'Contato X' });
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe('https://api.egestor.com.br/api/v1/contatos/1');
      expect(options.method).toBe('GET');
    });

    it('lança erro quando a API responde HTTP não-2xx', async () => {
      const http = new EgestorHttpService();
      mockFetchOnce(404, { errCode: 404 });

      await expect(
        http.getOne('token-abc', '/v1/contatos/999'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('put', () => {
    it('manda o payload em JSON no corpo e devolve o objeto atualizado', async () => {
      const http = new EgestorHttpService();
      mockFetchOnce(200, { codigo: '1', nome: 'Nome corrigido' });

      const atualizado = await http.put<FakeContato & { nome: string }>(
        'token-abc',
        '/v1/contatos/1',
        { nome: 'Nome corrigido' },
      );

      expect(atualizado).toEqual({ codigo: '1', nome: 'Nome corrigido' });
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe('https://api.egestor.com.br/api/v1/contatos/1');
      expect(options.method).toBe('PUT');
      expect(JSON.parse(options.body)).toEqual({ nome: 'Nome corrigido' });
    });

    it('lança erro quando a API responde HTTP não-2xx', async () => {
      const http = new EgestorHttpService();
      mockFetchOnce(400, { errCode: 400 });

      await expect(http.put('token-abc', '/v1/contatos/1', {})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('post', () => {
    it('manda o payload em JSON no corpo e devolve o objeto criado', async () => {
      const http = new EgestorHttpService();
      mockFetchOnce(200, { codigo: 42, nome: 'Contato novo' });

      const criado = await http.post<{ codigo: number; nome: string }>(
        'token-abc',
        '/v1/contatos',
        { nome: 'Contato novo', tipo: ['cliente'] },
      );

      expect(criado).toEqual({ codigo: 42, nome: 'Contato novo' });
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toBe('https://api.egestor.com.br/api/v1/contatos');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({
        nome: 'Contato novo',
        tipo: ['cliente'],
      });
    });

    it('lança erro quando a API responde HTTP não-2xx', async () => {
      const http = new EgestorHttpService();
      mockFetchOnce(422, { errCode: 422 });

      await expect(http.post('token-abc', '/v1/contatos', {})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('throttle', () => {
    it('não espera na 1ª chamada, mas pede uma pausa positiva antes da 2ª (rate limit de 60/min)', async () => {
      const http = new EgestorHttpService();
      mockFetchOnce(200, {
        data: [{ codigo: 1 }],
        last_page: 2,
        current_page: 1,
        total: 2,
        per_page: 1,
      });
      mockFetchOnce(200, {
        data: [{ codigo: 2 }],
        last_page: 2,
        current_page: 2,
        total: 2,
        per_page: 1,
      });

      await http.getAllPages<FakeContato>('token-abc', '/v1/contatos', {});

      // setTimeout só é chamado quando o throttle decide esperar — 1x
      // aqui (antes da 2ª página; a 1ª nunca espera, é a primeira
      // chamada da instância).
      expect(global.setTimeout).toHaveBeenCalledTimes(1);
      const [, waitMs] = (global.setTimeout as unknown as jest.Mock).mock
        .calls[0];
      expect(waitMs).toBeGreaterThan(1000);
      expect(waitMs).toBeLessThanOrEqual(1100);
    });
  });
});
