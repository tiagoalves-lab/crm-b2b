import { ConfigService } from '@nestjs/config';
import type { ReportConfigService } from './report-config.service';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenancy/tenant-context.service';
import { ReportSchedulerService } from './report-scheduler.service';
import type { ReportService } from './report.service';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const HOJE = new Date('2026-09-15T11:00:00.000Z'); // 8h em Brasília

const AMBIENTE: Record<string, unknown> = {
  reportTz: 'America/Sao_Paulo',
  reportAppUrl: 'https://crm.exemplo.com.br',
  reportAlertaTo: [],
  reportTo: [],
  reportFollowupHorarios: ['10:00', '11:50', '14:00', '16:30'],
  reportFollowupEtapas: [
    'Solicitação de Propostas',
    'Elaboração de Propostas',
    'Aprovação de Propostas',
  ],
};

interface Deps {
  prisma: { workspace: { findUniqueOrThrow: jest.Mock } };
  tenantContext: { run: jest.Mock };
  reports: {
    coletarDiario: jest.Mock;
    coletarFollowup: jest.Mock;
    membrosElegiveis: jest.Mock;
    emailsDe: jest.Mock;
    aplicarNomes: jest.Mock;
  };
  mail: { configurado: boolean; send: jest.Mock };
  reportConfig: { listar: jest.Mock; obter: jest.Mock };
  tx: { reportLog: { findUnique: jest.Mock; upsert: jest.Mock } };
}

function coletaVazia() {
  return {
    dataExtenso: 'Segunda-feira, 15 de setembro de 2026',
    diaCurto: '15/09',
    diaSemana: 'Segunda-feira',
    totalEmAberto: 1000,
    totalOportunidades: 1,
    semValorDefinido: 0,
    etapas: [],
    pipeline: [],
    fixadas: [],
    tarefas: [],
    totalTarefasPendentes: 0,
    tarefasAtrasadas: 0,
    userIds: [],
  };
}

// Configuração default dos dois reports, como a tela gravaria.
const CONFIG_PADRAO = [
  {
    tipo: 'pipeline-diario',
    ativo: true,
    horarios: ['08:00'],
    diasUteis: true,
    etapas: [],
  },
  {
    tipo: 'pipeline-followup',
    ativo: true,
    horarios: ['10:00', '11:50', '14:00', '16:30'],
    diasUteis: true,
    etapas: ['Solicitação de Propostas'],
  },
];

function followupComUmaLinha() {
  return {
    dados: {
      dataExtenso: 'Terça-feira, 15 de setembro de 2026',
      diaCurto: '15/09',
      horario: '10h',
      etapasAcompanhadas: ['Solicitação de Propostas'],
      totalEmAberto: 20200,
      totalOportunidades: 1,
      semValorDefinido: 0,
      maiorSla: 12,
      pipeline: [
        {
          nr: 1,
          abertura: '03/09',
          fechamentoPrevisto: null,
          empresa: 'Metalúrgica Exemplo',
          representante: 'user-1',
          etapa: 'Solicitação de Propostas',
          etapaOrdem: 1,
          slaDias: 12,
          itens: ['Máquina A'],
          valor: 20200,
        },
      ],
    },
    userIds: ['user-1'],
    etapasEncontradas: ['Solicitação de Propostas'],
  };
}

function montar(
  overrides: {
    logExistente?: unknown;
    configs?: unknown[];
  } = {},
): {
  service: ReportSchedulerService;
  deps: Deps;
} {
  const tx: Deps['tx'] = {
    reportLog: {
      findUnique: jest.fn().mockResolvedValue(overrides.logExistente ?? null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };

  const deps: Deps = {
    prisma: {
      workspace: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: WORKSPACE_ID }),
      },
    },
    // Roda o callback direto contra a tx falsa, sem transação de verdade.
    tenantContext: {
      run: jest.fn((_ctx: unknown, fn: (tx: Deps['tx']) => unknown) => fn(tx)),
    },
    reports: {
      coletarDiario: jest.fn().mockResolvedValue(coletaVazia()),
      coletarFollowup: jest.fn().mockResolvedValue(followupComUmaLinha()),
      membrosElegiveis: jest.fn().mockResolvedValue(['user-1']),
      emailsDe: jest
        .fn()
        .mockResolvedValue({ emails: ['gestor@exemplo.com.br'], semEmail: [] }),
      aplicarNomes: jest.fn().mockResolvedValue(undefined),
    },
    mail: {
      configurado: true,
      send: jest.fn().mockResolvedValue({ ok: true, id: 'msg-1' }),
    },
    reportConfig: {
      listar: jest.fn().mockResolvedValue(overrides.configs ?? CONFIG_PADRAO),
      obter: jest
        .fn()
        .mockImplementation((_tx: unknown, _ws: string, tipo: string) =>
          Promise.resolve(
            (overrides.configs ?? CONFIG_PADRAO).find(
              (c: { tipo: string }) => c.tipo === tipo,
            ),
          ),
        ),
    },
    tx,
  };

  const config = {
    get: jest.fn((chave: string) => AMBIENTE[chave]),
  } as unknown as ConfigService;

  const service = new ReportSchedulerService(
    deps.prisma as unknown as PrismaService,
    deps.tenantContext as unknown as TenantContextService,
    deps.reports as unknown as ReportService,
    deps.mail as unknown as MailService,
    config,
    deps.reportConfig as unknown as ReportConfigService,
  );
  return { service, deps };
}

describe('ReportSchedulerService', () => {
  it('envia o resumo e registra o dia', async () => {
    const { service, deps } = montar();

    const resultado = await service.enviarDiario(HOJE);

    expect(resultado.status).toBe('enviado');
    expect(deps.mail.send).toHaveBeenCalledTimes(1);
    const [params] = deps.mail.send.mock.calls[0] as [
      { to: string[]; idempotencyKey: string; subject: string },
    ];
    expect(params.to).toEqual(['gestor@exemplo.com.br']);
    // Dia de referência no fuso de Brasília, não no UTC do container.
    expect(params.idempotencyKey).toBe('report-pipeline-diario:2026-09-15');
    expect(deps.tx.reportLog.upsert).toHaveBeenCalledTimes(1);
  });

  it('rodando duas vezes no mesmo dia, manda um e-mail só', async () => {
    const primeira = montar();
    await primeira.service.enviarDiario(HOJE);

    // Segunda execução do mesmo dia: o registro de envio já existe.
    const segunda = montar({
      logExistente: {
        status: 'enviado',
        destinatarios: 1,
        messageId: 'msg-1',
      },
    });
    const resultado = await segunda.service.enviarDiario(HOJE);

    expect(resultado.status).toBe('ja-enviado');
    expect(segunda.deps.mail.send).not.toHaveBeenCalled();
    expect(segunda.deps.tx.reportLog.upsert).not.toHaveBeenCalled();
  });

  it('falha do provedor vira registro de falha, sem derrubar o job', async () => {
    const { service, deps } = montar();
    deps.mail.send.mockResolvedValue({ ok: false, error: 'HTTP 500' });

    const resultado = await service.enviarDiario(HOJE);

    expect(resultado.status).toBe('falha');
    expect(resultado.erro).toBe('HTTP 500');
    // Duas tentativas antes de desistir.
    expect(deps.mail.send).toHaveBeenCalledTimes(2);
    expect(deps.tx.reportLog.upsert).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('sem ninguém para receber, registra falha e não chama o provedor', async () => {
    const { service, deps } = montar();
    deps.reports.emailsDe.mockResolvedValue({
      emails: [],
      semEmail: ['user-1'],
    });

    const resultado = await service.enviarDiario(HOJE);

    expect(resultado.status).toBe('falha');
    expect(deps.mail.send).not.toHaveBeenCalled();
    expect(deps.tx.reportLog.upsert).toHaveBeenCalledTimes(1);
  });

  it('não envia nada quando o e-mail não está configurado', async () => {
    const { service, deps } = montar();
    deps.mail.configurado = false;

    const resultado = await service.enviarDiario(HOJE);

    expect(resultado.status).toBe('desligado');
    expect(deps.mail.send).not.toHaveBeenCalled();
  });

  it('conferência avisa quando o resumo do dia não saiu', async () => {
    const { service, deps } = montar({
      logExistente: { status: 'falha', erro: 'HTTP 500', destinatarios: 0 },
    });

    const ok = await service.conferirEnvioDoDia(HOJE);

    expect(ok).toBe(false);
    const [params] = deps.mail.send.mock.calls[0] as [
      { subject: string; to: string[] },
    ];
    expect(params.subject).toContain('não foi enviado');
    expect(params.to).toEqual(['gestor@exemplo.com.br']);
  });

  it('conferência fica quieta quando o resumo saiu', async () => {
    const { service, deps } = montar({
      logExistente: { status: 'enviado', destinatarios: 3 },
    });

    const ok = await service.conferirEnvioDoDia(HOJE);

    expect(ok).toBe(true);
    expect(deps.mail.send).not.toHaveBeenCalled();
  });

  // ── Follow-up das cotações (2026-09-15) ──────────────────────────────
  describe('follow-up de cotações', () => {
    const DEZ_HORAS = new Date('2026-09-15T13:00:00.000Z'); // 10h em Brasília

    it('envia com chave de idempotência por HORÁRIO, não por dia', async () => {
      const { service, deps } = montar();

      const resultado = await service.enviarFollowup(DEZ_HORAS);

      expect(resultado.status).toBe('enviado');
      const [params] = deps.mail.send.mock.calls[0] as [
        { subject: string; idempotencyKey: string; html: string },
      ];
      // Quatro rodadas por dia: a trava precisa distinguir uma da outra.
      expect(params.idempotencyKey).toBe(
        'report-pipeline-followup:2026-09-15 10h',
      );
      expect(params.subject).toContain('Follow-up de cotações');
      expect(params.subject).toContain('10h');
      expect(params.html).toContain('Metalúrgica Exemplo');
    });

    it('não repete a mesma rodada', async () => {
      const { service, deps } = montar({
        logExistente: { status: 'enviado', destinatarios: 6, messageId: 'm' },
      });

      const resultado = await service.enviarFollowup(DEZ_HORAS);

      expect(resultado.status).toBe('ja-enviado');
      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('sem cotação nas etapas acompanhadas, não manda e-mail nenhum', async () => {
      const { service, deps } = montar();
      deps.reports.coletarFollowup.mockResolvedValue({
        dados: { ...followupComUmaLinha().dados, pipeline: [], totalOportunidades: 0 },
        userIds: [],
        etapasEncontradas: ['Solicitação de Propostas'],
      });

      const resultado = await service.enviarFollowup(DEZ_HORAS);

      // Quatro e-mails por dia dizendo "não há nada" viram ruído.
      expect(resultado.status).toBe('enviado');
      expect(resultado.destinatarios).toBe(0);
      expect(deps.mail.send).not.toHaveBeenCalled();
      expect(deps.tx.reportLog.upsert).toHaveBeenCalledTimes(1);
    });

  });

  // O agendamento passou a ser um tick de minuto em minuto lendo a
  // configuração da tela (2026-09-15) — é aqui que se prova que o
  // horário certo dispara e que os outros minutos ficam quietos.
  describe('tick (agendamento pela configuração da tela)', () => {
    const DEZ_HORAS = new Date('2026-09-15T13:00:00.000Z'); // 10h, terça
    const DEZ_E_TRES = new Date('2026-09-15T13:03:00.000Z');
    const DEZ_E_DEZ = new Date('2026-09-15T13:10:00.000Z');
    const SABADO = new Date('2026-09-19T13:00:00.000Z'); // 10h, sábado

    it('dispara o follow-up no horário configurado', async () => {
      const { service, deps } = montar();

      await service.tick(DEZ_HORAS);

      expect(deps.mail.send).toHaveBeenCalledTimes(1);
      const [params] = deps.mail.send.mock.calls[0] as [{ subject: string }];
      expect(params.subject).toContain('Follow-up de cotações');
    });

    it('recupera um disparo atrasado poucos minutos', async () => {
      const { service, deps } = montar();

      await service.tick(DEZ_E_TRES);

      expect(deps.mail.send).toHaveBeenCalledTimes(1);
      const [params] = deps.mail.send.mock.calls[0] as [
        { idempotencyKey: string },
      ];
      // Atrasado ou não, a rodada continua sendo a das 10h — é o que
      // impede o atraso de virar um segundo e-mail.
      expect(params.idempotencyKey).toBe(
        'report-pipeline-followup:2026-09-15 10h',
      );
    });

    it('não dispara fora da janela do horário', async () => {
      const { service, deps } = montar();

      await service.tick(DEZ_E_DEZ);

      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('não dispara em fim de semana quando a regra é dias úteis', async () => {
      const { service, deps } = montar();

      await service.tick(SABADO);

      expect(deps.mail.send).not.toHaveBeenCalled();
    });

    it('report desligado na tela não dispara', async () => {
      const { service, deps } = montar({
        configs: [
          { ...CONFIG_PADRAO[0], ativo: false },
          { ...CONFIG_PADRAO[1], ativo: false },
        ],
      });

      await service.tick(DEZ_HORAS);

      expect(deps.mail.send).not.toHaveBeenCalled();
    });
  });
});
