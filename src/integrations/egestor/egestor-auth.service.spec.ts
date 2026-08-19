import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { EgestorAuthService } from './egestor-auth.service';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function mockFetchOnce(status: number, body: unknown): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// Fluxo OAuth de 2 passos (docs/api-egestor-contatos.md) — aqui só o
// passo 1 (personal_token → access_token). O passo 2 (usar o
// access_token num GET/POST) é responsabilidade de EgestorHttpService,
// testado à parte.
describe('EgestorAuthService', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('troca personal_token por access_token com sucesso', async () => {
    const service = new EgestorAuthService(
      fakeConfig({ egestorApiTokenMatriz: 'personal-matriz' }),
    );
    mockFetchOnce(200, {
      access_token: 'token-123',
      token_type: 'Bearer',
      expires_in: 900,
    });

    const token = await service.getAccessToken('matriz');

    expect(token).toBe('token-123');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.egestor.com.br/api/oauth/access_token',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      }),
    );
    // O personal_token nunca aparece na URL (só no body) — confirma que
    // não vaza em log de request/URL.
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(options.body)).toContain('personal_token=personal-matriz');
    expect(String(options.body)).toContain('grant_type=personal');
  });

  it('usa o token da Filial quando pedido pra "filial", não o da Matriz', async () => {
    const service = new EgestorAuthService(
      fakeConfig({
        egestorApiTokenMatriz: 'personal-matriz',
        egestorApiTokenFilial: 'personal-filial',
      }),
    );
    mockFetchOnce(200, { access_token: 'token-filial-xyz' });

    await service.getAccessToken('filial');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(options.body)).toContain('personal_token=personal-filial');
  });

  it('lança erro sem chamar a API quando o personal_token não está configurado', async () => {
    const service = new EgestorAuthService(fakeConfig({}));

    await expect(service.getAccessToken('matriz')).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lança erro quando a API responde HTTP não-2xx (ex.: personal_token inválido)', async () => {
    const service = new EgestorAuthService(
      fakeConfig({ egestorApiTokenMatriz: 'personal-invalido' }),
    );
    mockFetchOnce(401, { errCode: 401, errMsg: 'access_denied' });

    await expect(service.getAccessToken('matriz')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('lança erro quando a resposta é 200 mas sem access_token no corpo', async () => {
    const service = new EgestorAuthService(
      fakeConfig({ egestorApiTokenMatriz: 'personal-matriz' }),
    );
    mockFetchOnce(200, { token_type: 'Bearer' });

    await expect(service.getAccessToken('matriz')).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});
