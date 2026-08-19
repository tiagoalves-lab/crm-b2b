import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MetaLeadsWebhookService } from './meta-leads-webhook.service';

const APP_SECRET = 'app-secret-de-teste';
const VERIFY_TOKEN = 'verify-token-de-teste';
const OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

interface Deps {
  config: { get: jest.Mock };
  prisma: { workspace: { findUniqueOrThrow: jest.Mock } };
  tenantContext: { run: jest.Mock };
  graph: { buscarLead: jest.Mock };
  rawLeads: { create: jest.Mock };
  contacts: { create: jest.Mock };
  tx: {
    metaLeadsWebhookEvent: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    membership: { findUnique: jest.Mock };
  };
}

// `mock.calls` é `any[][]` — tipar a leitura num helper só evita espalhar
// asserção de tipo (e erro de lint) por cada expect que inspeciona
// argumento de chamada.
function argumentos<A, B = unknown, C = unknown, D = unknown>(
  mock: jest.Mock,
  chamada = 0,
): [A, B, C, D] {
  return (mock.mock.calls as unknown[][])[chamada] as [A, B, C, D];
}

// `tenantContext.run` é sempre chamado com um callback que recebe a tx —
// aqui roda o callback direto contra o mock de tx, sem transação de verdade.
function montar(overrides: Partial<Record<string, unknown>> = {}): {
  service: MetaLeadsWebhookService;
  deps: Deps;
} {
  const tx = {
    metaLeadsWebhookEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evento-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    membership: jest.fn() as never,
  } as unknown as Deps['tx'];
  tx.membership = {
    findUnique: jest.fn().mockResolvedValue({
      id: 'membership-1',
      userId: OWNER_USER_ID,
      workspaceId: WORKSPACE_ID,
      role: 'manager',
      status: 'active',
      permissions: null,
    }),
  };

  const configValues: Record<string, string | undefined> = {
    metaAppSecret: APP_SECRET,
    metaVerifyToken: VERIFY_TOKEN,
    metaLeadsDefaultOwnerUserId: OWNER_USER_ID,
    ...(overrides.config as Record<string, string | undefined>),
  };

  const deps: Deps = {
    config: { get: jest.fn((chave: string) => configValues[chave]) },
    prisma: {
      workspace: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: WORKSPACE_ID }),
      },
    },
    tenantContext: {
      run: jest.fn((_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    },
    graph: {
      buscarLead: jest.fn().mockResolvedValue({
        id: 'lead-1',
        field_data: [
          { name: 'full_name', values: ['Joana Prado'] },
          { name: 'email', values: ['joana@exemplo.com.br'] },
        ],
      }),
    },
    rawLeads: {
      create: jest.fn().mockResolvedValue({
        id: 'raw-lead-1',
        promotedCompanyId: 'company-1',
      }),
    },
    contacts: { create: jest.fn().mockResolvedValue({}) },
    tx,
  };

  const service = new MetaLeadsWebhookService(
    deps.config as never,
    deps.prisma as never,
    deps.tenantContext as never,
    deps.graph as never,
    deps.rawLeads as never,
    deps.contacts as never,
  );
  return { service, deps };
}

function payloadLeadgen(leadgenId = '9001') {
  return {
    object: 'page',
    entry: [
      {
        id: 'page-1',
        time: 1_700_000_000,
        changes: [
          {
            field: 'leadgen',
            value: {
              leadgen_id: leadgenId,
              page_id: 'page-1',
              form_id: 'form-1',
              ad_id: 'ad-1',
              created_time: 1_700_000_000,
            } as Record<string, unknown>,
          },
        ],
      },
    ],
  };
}

describe('MetaLeadsWebhookService', () => {
  describe('assertAssinaturaValida', () => {
    const corpo = Buffer.from('{"object":"page"}');
    const assinaturaValida = `sha256=${createHmac('sha256', APP_SECRET).update(corpo).digest('hex')}`;

    it('aceita assinatura correta', () => {
      const { service } = montar();
      expect(() =>
        service.assertAssinaturaValida(corpo, assinaturaValida),
      ).not.toThrow();
    });

    it('recusa assinatura de outro segredo', () => {
      const { service } = montar();
      const forjada = `sha256=${createHmac('sha256', 'outro-segredo').update(corpo).digest('hex')}`;
      expect(() => service.assertAssinaturaValida(corpo, forjada)).toThrow(
        UnauthorizedException,
      );
    });

    it('recusa corpo alterado depois de assinado', () => {
      const { service } = montar();
      expect(() =>
        service.assertAssinaturaValida(
          Buffer.from('{"object":"page","x":1}'),
          assinaturaValida,
        ),
      ).toThrow(UnauthorizedException);
    });

    it('recusa header ausente ou sem o prefixo sha256=', () => {
      const { service } = montar();
      expect(() => service.assertAssinaturaValida(corpo, undefined)).toThrow(
        UnauthorizedException,
      );
      expect(() => service.assertAssinaturaValida(corpo, 'abc123')).toThrow(
        UnauthorizedException,
      );
    });

    it('recusa quando o corpo cru não chegou (rawBody desligado)', () => {
      const { service } = montar();
      expect(() =>
        service.assertAssinaturaValida(undefined, assinaturaValida),
      ).toThrow(UnauthorizedException);
    });

    it('recusa quando META_APP_SECRET não está configurado', () => {
      const { service } = montar({ config: { metaAppSecret: undefined } });
      expect(() =>
        service.assertAssinaturaValida(corpo, assinaturaValida),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('verificarHandshake', () => {
    it('devolve o challenge quando mode e token batem', () => {
      const { service } = montar();
      expect(
        service.verificarHandshake('subscribe', VERIFY_TOKEN, 'desafio-123'),
      ).toBe('desafio-123');
    });

    it('recusa token errado', () => {
      const { service } = montar();
      expect(() =>
        service.verificarHandshake('subscribe', 'errado', 'desafio-123'),
      ).toThrow(UnauthorizedException);
    });

    it('recusa mode diferente de subscribe', () => {
      const { service } = montar();
      expect(() =>
        service.verificarHandshake('unsubscribe', VERIFY_TOKEN, 'desafio-123'),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('handleEvent', () => {
    it('cria RawLead e Contact e marca o evento processado', async () => {
      const { service, deps } = montar();

      const resultados = await service.handleEvent(payloadLeadgen());

      expect(resultados).toEqual([
        { leadgenId: '9001', resultado: 'raw_lead_e_contato_criados' },
      ]);
      expect(deps.graph.buscarLead).toHaveBeenCalledWith('9001');
      expect(deps.rawLeads.create).toHaveBeenCalledTimes(1);
      expect(deps.contacts.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: OWNER_USER_ID }),
        'company-1',
        expect.objectContaining({ nome: 'Joana Prado' }),
      );
      const { data } = argumentos<{ data: Record<string, unknown> }>(
        deps.tx.metaLeadsWebhookEvent.update,
      )[0];
      expect(data).toMatchObject({ rawLeadId: 'raw-lead-1' });
      expect(data.processedAt).toBeInstanceOf(Date);
    });

    it('cria o lead na carteira do gerente configurado, não do ator sistema', async () => {
      const { service, deps } = montar();

      await service.handleEvent(payloadLeadgen());

      // A criação do RawLead roda num contexto de tenant cujo userId é o do
      // gerente — é isso que faz o lead nascer na carteira certa (RLS +
      // RawLeadService#create usam o mesmo userId).
      const contextos = (deps.tenantContext.run.mock.calls as unknown[][]).map(
        (call) => call[0] as { userId: string; role?: string },
      );
      expect(contextos).toContainEqual(
        expect.objectContaining({ userId: OWNER_USER_ID, role: 'manager' }),
      );
      const membershipUsado = argumentos<
        unknown,
        { userId: string; role: string }
      >(deps.rawLeads.create)[1];
      expect(membershipUsado.userId).toBe(OWNER_USER_ID);
    });

    it('não reprocessa evento já processado (retry da Meta)', async () => {
      const { service, deps } = montar();
      deps.tx.metaLeadsWebhookEvent.findFirst.mockResolvedValue({
        id: 'evento-1',
        processedAt: new Date(),
        processResult: 'raw_lead_criado',
      });

      const resultados = await service.handleEvent(payloadLeadgen());

      expect(resultados).toEqual([
        { leadgenId: '9001', resultado: 'raw_lead_criado' },
      ]);
      expect(deps.graph.buscarLead).not.toHaveBeenCalled();
      expect(deps.rawLeads.create).not.toHaveBeenCalled();
    });

    it('reprocessa evento já registrado mas ainda não processado', async () => {
      const { service, deps } = montar();
      deps.tx.metaLeadsWebhookEvent.findFirst.mockResolvedValue({
        id: 'evento-1',
        processedAt: null,
      });

      await service.handleEvent(payloadLeadgen());

      expect(deps.tx.metaLeadsWebhookEvent.create).not.toHaveBeenCalled();
      expect(deps.rawLeads.create).toHaveBeenCalledTimes(1);
    });

    it('guarda o payload do lead sem criar RawLead quando não há gerente configurado', async () => {
      const { service, deps } = montar({
        config: { metaLeadsDefaultOwnerUserId: undefined },
      });

      const resultados = await service.handleEvent(payloadLeadgen());

      expect(resultados).toEqual([
        { leadgenId: '9001', resultado: 'owner_nao_configurado' },
      ]);
      expect(deps.rawLeads.create).not.toHaveBeenCalled();
      // Evento NÃO é marcado processado — fica pendente pra reprocessar
      // quando a variável for configurada, e o payload buscado não se perde.
      const { data } = argumentos<{ data: Record<string, unknown> }>(
        deps.tx.metaLeadsWebhookEvent.update,
      )[0];
      expect(data.leadPayload).toBeDefined();
      expect(data.processedAt).toBeUndefined();
    });

    it('trata gerente inativo igual a não configurado', async () => {
      const { service, deps } = montar();
      deps.tx.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: OWNER_USER_ID,
        workspaceId: WORKSPACE_ID,
        role: 'manager',
        status: 'suspended',
        permissions: null,
      });

      const resultados = await service.handleEvent(payloadLeadgen());

      expect(resultados[0].resultado).toBe('owner_nao_configurado');
      expect(deps.rawLeads.create).not.toHaveBeenCalled();
    });

    it('ignora mudança que não é leadgen e payload sem entry', async () => {
      const { service, deps } = montar();

      expect(
        await service.handleEvent({
          object: 'page',
          entry: [
            {
              id: 'page-1',
              changes: [{ field: 'feed', value: { post_id: 'x' } }],
            },
          ],
        }),
      ).toEqual([]);
      expect(await service.handleEvent({ object: 'page' })).toEqual([]);
      expect(deps.prisma.workspace.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('processa cada lead de um POST com vários eventos agrupados', async () => {
      const { service, deps } = montar();
      const payload = {
        object: 'page',
        entry: [
          {
            id: 'page-1',
            changes: [
              {
                field: 'leadgen',
                value: { leadgen_id: '9001', page_id: 'page-1' } as Record<
                  string,
                  unknown
                >,
              },
              {
                field: 'leadgen',
                value: { leadgen_id: '9002', page_id: 'page-1' } as Record<
                  string,
                  unknown
                >,
              },
            ],
          },
        ],
      };

      const resultados = await service.handleEvent(payload);

      expect(resultados).toHaveLength(2);
      expect(deps.rawLeads.create).toHaveBeenCalledTimes(2);
    });
  });
});
