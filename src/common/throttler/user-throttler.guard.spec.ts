import { UserThrottlerGuard } from './user-throttler.guard';

// getTracker é um método puro (não toca no storage nem no contexto do
// Nest), então dá pra testá-lo sem montar o módulo inteiro — instanciar
// pelo prototype evita ter que fabricar as 3 dependências do
// ThrottlerGuard só pra exercitar uma função de uma linha.
type TrackerOnly = { getTracker(req: unknown): Promise<string> };

const guard = Object.create(UserThrottlerGuard.prototype) as TrackerOnly;

describe('UserThrottlerGuard#getTracker', () => {
  it('chaveia pelo id do usuário autenticado', async () => {
    await expect(
      guard.getTracker({ user: { id: 'abc-123' }, ip: '10.0.0.1' }),
    ).resolves.toBe('user:abc-123');
  });

  // O ponto central: dois usuários diferentes atrás do MESMO IP (que é o
  // caso real — todo tráfego chega dos servidores da Vercel) precisam
  // cair em baldes distintos. Se este teste falhar, o rate limit virou
  // global e derruba o CRM pra todo mundo. Ver docs/seguranca.md 5.4.
  it('separa usuários distintos que compartilham o mesmo IP', async () => {
    const ip = '76.76.21.21';
    const primeiro = await guard.getTracker({ user: { id: 'user-a' }, ip });
    const segundo = await guard.getTracker({ user: { id: 'user-b' }, ip });

    expect(primeiro).not.toBe(segundo);
  });

  it('cai no IP quando não há usuário (rota pública)', async () => {
    await expect(guard.getTracker({ ip: '10.0.0.1' })).resolves.toBe(
      'ip:10.0.0.1',
    );
  });

  it('prefere o IP do X-Forwarded-For quando o Express expõe req.ips', async () => {
    await expect(
      guard.getTracker({ ip: '10.0.0.1', ips: ['203.0.113.9', '10.0.0.1'] }),
    ).resolves.toBe('ip:203.0.113.9');
  });

  it('não quebra quando não há usuário nem IP', async () => {
    await expect(guard.getTracker({})).resolves.toBe('ip:desconhecido');
  });
});
