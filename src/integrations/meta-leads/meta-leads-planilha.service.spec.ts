import { UnauthorizedException } from '@nestjs/common';
import { MetaLeadsPlanilhaService } from './meta-leads-planilha.service';
import type { MetaLeadDetail } from './meta-leads.types';

const TOKEN = 'token-planilha-de-teste';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

interface Deps {
  config: { get: jest.Mock };
  tenantContext: { run: jest.Mock };
  webhook: {
    resolverWorkspaceId: jest.Mock;
    criarLeadNoCrm: jest.Mock;
  };
  tx: {
    metaLeadsWebhookEvent: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };
}

function argumentos<A, B = unknown, C = unknown, D = unknown, E = unknown>(
  mock: jest.Mock,
  chamada = 0,
): [A, B, C, D, E] {
  return (mock.mock.calls as unknown[][])[chamada] as [A, B, C, D, E];
}

function montar(overrides: { token?: string | undefined } = {}): {
  service: MetaLeadsPlanilhaService;
  deps: Deps;
} {
  const tx: Deps['tx'] = {
    metaLeadsWebhookEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evento-1' }),
    },
  };
  const token = 'token' in overrides ? overrides.token : TOKEN;
  const deps: Deps = {
    config: {
      get: jest.fn((chave: string) =>
        chave === 'metaLeadsPlanilhaToken' ? token : undefined,
      ),
    },
    tenantContext: {
      run: jest.fn((_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    },
    webhook: {
      resolverWorkspaceId: jest.fn().mockResolvedValue(WORKSPACE_ID),
      criarLeadNoCrm: jest.fn().mockResolvedValue('raw_lead_e_contato_criados'),
    },
    tx,
  };
  const service = new MetaLeadsPlanilhaService(
    deps.config as never,
    deps.tenantContext as never,
    deps.webhook as never,
  );
  return { service, deps };
}

// Linha real (anonimizada) da aba "Query CRM" — cabeçalho exatamente como
// o export da Central de Leads escreve, valores com os prefixos "l:",
// "ag:", "p:" etc.
function linhaReal(overrides: Record<string, unknown> = {}) {
  return {
    id: typeof overrides.id === 'string' ? overrides.id : 'l:1866460950984118',
    campos: {
      id: 'l:1866460950984118',
      created_time: '2026-09-04T05:28:40-05:00',
      ad_id: 'ag:120254459357310581',
      ad_name: 'C2 - VIDEO',
      adset_id: 'as:120254459357300581',
      adset_name: 'CJ2 | INTERESSES-INDÚSTRIA',
      campaign_id: 'c:120254431505710581',
      campaign_name: 'GAMA | TOF | LEADS-FORM',
      form_id: 'f:1362134419424281',
      form_name: 'Orçamento | Máquinas Industriais Gama',
      is_organic: 'false',
      platform: 'ig',
      'qual_equipamento_você_procura?': 'máquina_de_corte_a_laser_para_chapas',
      'quando_pretende_adquirir_o_equipamento?': 'imediatamente',
      'sua_empresa_já_utiliza_máquinas_desse_tipo?':
        'sim,_queremos_ampliar_ou_substituir',
      'qual_o_cnpj_da_sua_empresa?': '',
      email: 'contato@exemplo.com.br',
      full_name: 'Joana Prado',
      phone_number: 'p:+5511900000000',
      city: 'São Paulo',
      company_name: 'Indústria Modelo',
      lead_status: 'CREATED',
      ...overrides,
    },
  };
}

describe('MetaLeadsPlanilhaService', () => {
  describe('assertTokenValido', () => {
    it('aceita o token configurado', () => {
      const { service } = montar();
      expect(() => service.assertTokenValido(`Bearer ${TOKEN}`)).not.toThrow();
    });

    it('recusa token diferente, header ausente e token não configurado', () => {
      const { service } = montar();
      expect(() => service.assertTokenValido('Bearer outro')).toThrow(
        UnauthorizedException,
      );
      expect(() => service.assertTokenValido(undefined)).toThrow(
        UnauthorizedException,
      );
      expect(() => service.assertTokenValido(TOKEN)).toThrow(
        UnauthorizedException,
      );

      const semToken = montar({ token: undefined });
      expect(() =>
        semToken.service.assertTokenValido(`Bearer ${TOKEN}`),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('receber', () => {
    it('registra o evento como vindo da planilha e entra na esteira do webhook', async () => {
      const { service, deps } = montar();

      const resultados = await service.receber({ linhas: [linhaReal()] });

      expect(resultados).toEqual([
        {
          leadgenId: '1866460950984118',
          resultado: 'raw_lead_e_contato_criados',
        },
      ]);

      // Evento gravado com origem 'planilha', ids sem o prefixo do export
      // e sem page_id (a planilha não traz).
      const { data } = argumentos<{ data: Record<string, unknown> }>(
        deps.tx.metaLeadsWebhookEvent.create,
      )[0];
      expect(data).toMatchObject({
        workspaceId: WORKSPACE_ID,
        origem: 'planilha',
        pageId: null,
        leadgenId: '1866460950984118',
        formId: '1362134419424281',
        adId: '120254459357310581',
      });
      expect(data.createdTimeMeta).toBeInstanceOf(Date);
      expect(data.processedAt).toBeUndefined();

      // Fase 3 compartilhada: recebe o lead no formato do GET /{leadgen_id}
      // — só respostas do formulário no field_data, telefone sem "p:", e o
      // metadado do anúncio no contexto da anotação.
      const [workspaceId, eventoId, leadgenId, detalhe, contexto] = argumentos<
        string,
        string,
        string,
        MetaLeadDetail,
        Record<string, unknown>
      >(deps.webhook.criarLeadNoCrm);
      expect(workspaceId).toBe(WORKSPACE_ID);
      expect(eventoId).toBe('evento-1');
      expect(leadgenId).toBe('1866460950984118');
      const nomes = (detalhe.field_data ?? []).map((f) => f.name);
      expect(nomes).toEqual(
        expect.arrayContaining([
          'qual_equipamento_você_procura?',
          'email',
          'full_name',
          'phone_number',
          'city',
          'company_name',
        ]),
      );
      expect(nomes).not.toEqual(
        expect.arrayContaining(['ad_name', 'campaign_name', 'lead_status']),
      );
      // Célula vazia (CNPJ não preenchido) não vira campo.
      expect(nomes).not.toContain('qual_o_cnpj_da_sua_empresa?');
      const telefone = (detalhe.field_data ?? []).find(
        (f) => f.name === 'phone_number',
      );
      expect(telefone?.values).toEqual(['+5511900000000']);
      expect(contexto).toEqual({
        plataforma: 'Instagram',
        formulario: 'Orçamento | Máquinas Industriais Gama',
        campanha: 'GAMA | TOF | LEADS-FORM',
        anuncio: 'C2 - VIDEO',
      });
    });

    it('ignora lead de teste da Meta, deixando o evento já processado', async () => {
      const { service, deps } = montar();

      const resultados = await service.receber({
        linhas: [
          linhaReal({
            id: 'l:1405879318274388',
            email: 'test@meta.com',
            full_name: '<test lead: dummy data for full_name>',
          }),
        ],
      });

      expect(resultados).toEqual([
        { leadgenId: '1405879318274388', resultado: 'lead_de_teste_ignorado' },
      ]);
      expect(deps.webhook.criarLeadNoCrm).not.toHaveBeenCalled();
      const { data } = argumentos<{ data: Record<string, unknown> }>(
        deps.tx.metaLeadsWebhookEvent.create,
      )[0];
      expect(data.processedAt).toBeInstanceOf(Date);
      expect(data.processResult).toBe('lead_de_teste_ignorado');
    });

    it('não reprocessa linha já processada (o script reenvia a planilha inteira)', async () => {
      const { service, deps } = montar();
      deps.tx.metaLeadsWebhookEvent.findFirst.mockResolvedValue({
        id: 'evento-antigo',
        processedAt: new Date(),
        processResult: 'raw_lead_criado',
      });

      const resultados = await service.receber({ linhas: [linhaReal()] });

      expect(resultados).toEqual([
        { leadgenId: '1866460950984118', resultado: 'raw_lead_criado' },
      ]);
      expect(deps.tx.metaLeadsWebhookEvent.create).not.toHaveBeenCalled();
      expect(deps.webhook.criarLeadNoCrm).not.toHaveBeenCalled();
    });

    it('reprocessa linha registrada mas ainda não processada (falha anterior)', async () => {
      const { service, deps } = montar();
      deps.tx.metaLeadsWebhookEvent.findFirst.mockResolvedValue({
        id: 'evento-pendente',
        processedAt: null,
      });

      await service.receber({ linhas: [linhaReal()] });

      expect(deps.tx.metaLeadsWebhookEvent.create).not.toHaveBeenCalled();
      expect(argumentos<string, string>(deps.webhook.criarLeadNoCrm)[1]).toBe(
        'evento-pendente',
      );
    });

    it('devolve vazio sem consultar nada quando não há linhas', async () => {
      const { service, deps } = montar();
      expect(await service.receber({ linhas: [] })).toEqual([]);
      expect(deps.webhook.resolverWorkspaceId).not.toHaveBeenCalled();
    });

    it('marca linha sem id em vez de derrubar o lote', async () => {
      const { service, deps } = montar();
      const resultados = await service.receber({
        linhas: [{ id: '', campos: { full_name: 'Sem id' } }, linhaReal()],
      });
      expect(resultados[0]).toEqual({
        leadgenId: '',
        resultado: 'linha_sem_id',
      });
      expect(resultados[1].resultado).toBe('raw_lead_e_contato_criados');
      expect(deps.webhook.criarLeadNoCrm).toHaveBeenCalledTimes(1);
    });
  });
});
