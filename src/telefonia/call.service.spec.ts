import type { Call } from '@prisma/client';
import { ActivityService } from '../activities/activity.service';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import { CallService, duracaoPorExtenso, textoDoRegistro } from './call.service';

const WORKSPACE_ID = 'workspace-1';
const USER_ID = 'user-sdr';
const COMPANY_ID = 'company-1';
const TELEFONE = '5551999998888';

function chamada(overrides: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    contactId: null,
    rawLeadId: null,
    taskId: null,
    telefone: TELEFONE,
    telefoneExibicao: '(51) 99999-8888',
    direcao: 'saida',
    resultado: null,
    iniciadaEm: new Date('2026-09-23T12:00:00Z'),
    atendidaEm: null,
    encerradaEm: null,
    duracaoSegundos: null,
    observacao: null,
    activityId: null,
    criadaEm: new Date('2026-09-23T12:00:00Z'),
    atualizadaEm: new Date('2026-09-23T12:00:00Z'),
    ...overrides,
  };
}

// tx falso com só o que este service toca. Cada teste ajusta o que
// interessa — mesmo molde dos outros specs de service do projeto.
function fakeTx(overrides: Record<string, unknown> = {}) {
  return {
    call: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    contact: { findFirst: jest.fn().mockResolvedValue(null) },
    activity: { update: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as TenantTx;
}

describe('CallService — o evento que volta da máquina do SDR', () => {
  let service: CallService;
  let activities: { emit: jest.Mock };

  beforeEach(() => {
    activities = { emit: jest.fn().mockResolvedValue({ id: 'activity-1' }) };
    service = new CallService(
      new PolicyService(),
      activities as unknown as ActivityService,
    );
  });

  it('chamada que terminou sem ninguém atender vira "não atendida" — não some do histórico', async () => {
    const aberta = chamada();
    const encerrada = chamada({
      encerradaEm: new Date('2026-09-23T12:00:30Z'),
      resultado: 'nao_atendida',
      duracaoSegundos: 0,
    });
    const tx = fakeTx({
      call: {
        findFirst: jest.fn().mockResolvedValue(aberta),
        create: jest.fn(),
        update: jest
          .fn()
          .mockResolvedValueOnce(encerrada)
          .mockResolvedValue({ ...encerrada, activityId: 'activity-1' }),
      },
      contact: { findFirst: jest.fn() },
      activity: { update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    await service.registrarEvento(tx, WORKSPACE_ID, USER_ID, {
      evento: 'encerrada',
      telefone: TELEFONE,
    });

    const update = (tx as unknown as { call: { update: jest.Mock } }).call
      .update;
    expect(update.mock.calls[0][0].data).toMatchObject({
      resultado: 'nao_atendida',
      duracaoSegundos: 0,
    });
    // Mesmo sem conversa, o registro aparece na ficha da empresa.
    expect(activities.emit).toHaveBeenCalledTimes(1);
  });

  it('conta a duração a partir do momento em que atenderam, não da discagem', async () => {
    const aberta = chamada({ atendidaEm: new Date('2026-09-23T12:00:20Z') });
    const encerrada = chamada({
      atendidaEm: aberta.atendidaEm,
      encerradaEm: new Date('2026-09-23T12:02:33Z'),
      resultado: 'atendida',
      duracaoSegundos: 133,
    });
    const tx = fakeTx({
      call: {
        findFirst: jest.fn().mockResolvedValue(aberta),
        create: jest.fn(),
        update: jest
          .fn()
          .mockResolvedValueOnce(encerrada)
          .mockResolvedValue({ ...encerrada, activityId: 'activity-1' }),
      },
      contact: { findFirst: jest.fn() },
      activity: { update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    await service.registrarEvento(tx, WORKSPACE_ID, USER_ID, {
      evento: 'encerrada',
      telefone: TELEFONE,
      em: '2026-09-23T12:02:33Z',
    });

    const update = (tx as unknown as { call: { update: jest.Mock } }).call
      .update;
    expect(update.mock.calls[0][0].data).toMatchObject({
      resultado: 'atendida',
      duracaoSegundos: 133,
    });
  });

  it('número irreconhecível (ramal, chamada sem identificação) não vira registro', async () => {
    const tx = fakeTx();
    const resultado = await service.registrarEvento(tx, WORKSPACE_ID, USER_ID, {
      evento: 'encerrada',
      telefone: '201',
    });
    expect(resultado).toBeNull();
    expect(activities.emit).not.toHaveBeenCalled();
  });
});

describe('texto que aparece na Timeline', () => {
  it('descreve a ligação em linguagem de ficha, com a anotação junto', () => {
    const texto = textoDoRegistro(
      chamada({
        resultado: 'atendida',
        duracaoSegundos: 133,
        encerradaEm: new Date(),
        observacao: 'Pediu proposta de duas máquinas.',
      }),
    );
    expect(texto).toBe(
      'Ligação atendida — 2 min 13 s\n\nPediu proposta de duas máquinas.',
    );
  });

  it('ligação recebida é descrita como recebida, não como feita', () => {
    const texto = textoDoRegistro(
      chamada({ direcao: 'entrada', resultado: 'nao_atendida' }),
    );
    expect(texto).toBe('Ligação perdida');
  });
});

describe('duracaoPorExtenso', () => {
  it.each([
    [45, '45 s'],
    [60, '1 min'],
    [133, '2 min 13 s'],
  ])('%i segundos vira "%s"', (segundos, esperado) => {
    expect(duracaoPorExtenso(segundos)).toBe(esperado);
  });
});
