import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const AMBIENTE: Record<string, unknown> = {
  resendApiKey: 're_chave_de_teste',
  mailFrom: 'Gama Brasil CRM <crm@send.exemplo.com.br>',
  mailReplyTo: 'comercial@exemplo.com.br',
};

function montar(ambiente: Record<string, unknown> = AMBIENTE): MailService {
  const config = {
    get: jest.fn((chave: string) => ambiente[chave]),
  } as unknown as ConfigService;
  return new MailService(config);
}

function respostaOk(body: unknown = { id: 'msg-1' }) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('MailService', () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
  });

  it('não tenta enviar sem chave/remetente configurados', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = montar({});
    const resultado = await service.send({
      to: ['alguem@exemplo.com.br'],
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(service.configurado).toBe(false);
    expect(resultado.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa remetente e responder-para do ambiente e manda a chave de idempotência', async () => {
    const fetchMock = jest.fn().mockResolvedValue(respostaOk());
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultado = await montar().send({
      to: ['um@exemplo.com.br', 'dois@exemplo.com.br'],
      subject: 'Resumo do dia',
      html: '<p>corpo</p>',
      idempotencyKey: 'report-pipeline-diario:2026-09-15',
    });

    expect(resultado).toEqual({ ok: true, id: 'msg-1' });
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(init.headers['Idempotency-Key']).toBe(
      'report-pipeline-diario:2026-09-15',
    );
    const enviado = JSON.parse(init.body) as Record<string, unknown>;
    expect(enviado.from).toBe(AMBIENTE.mailFrom);
    expect(enviado.reply_to).toBe(AMBIENTE.mailReplyTo);
    expect(enviado.to).toEqual(['um@exemplo.com.br', 'dois@exemplo.com.br']);
  });

  it('manda uma vez só para a lista inteira, sem repetir endereço', async () => {
    const fetchMock = jest.fn().mockResolvedValue(respostaOk());
    global.fetch = fetchMock as unknown as typeof fetch;

    await montar().send({
      to: ['Um@Exemplo.com.br', 'um@exemplo.com.br', ' dois@exemplo.com.br '],
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const enviado = JSON.parse(init.body) as { to: string[] };
    expect(enviado.to).toEqual(['um@exemplo.com.br', 'dois@exemplo.com.br']);
  });

  it('devolve erro sem lançar quando o provedor recusa', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'domínio não verificado' }),
    } as unknown as Response) as unknown as typeof fetch;

    const resultado = await montar().send({
      to: ['alguem@exemplo.com.br'],
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('domínio não verificado');
  });

  it('devolve erro sem lançar quando a rede falha', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND')) as never;

    const resultado = await montar().send({
      to: ['alguem@exemplo.com.br'],
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain('ENOTFOUND');
  });

  it('recusa envio acima do teto de 50 endereços do provedor', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultado = await montar().send({
      to: Array.from({ length: 51 }, (_, i) => `pessoa${i}@exemplo.com.br`),
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(resultado.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
