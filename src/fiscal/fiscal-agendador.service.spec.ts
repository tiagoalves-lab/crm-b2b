import { FiscalAgendadorService, primeiroDiaDoMesAnterior } from './fiscal-agendador.service';

describe('primeiroDiaDoMesAnterior', () => {
  it('volta pro 1º dia do mês anterior, virando o ano quando precisa', () => {
    expect(primeiroDiaDoMesAnterior(new Date('2026-10-21T12:00:00Z'))).toBe('2026-09-01');
    expect(primeiroDiaDoMesAnterior(new Date('2026-01-15T12:00:00Z'))).toBe('2025-12-01');
  });

  it('usa o dia de Brasília, não o UTC', () => {
    // 1º/11 às 02h UTC ainda é 31/10 em Brasília.
    expect(primeiroDiaDoMesAnterior(new Date('2026-11-01T02:00:00Z'))).toBe('2026-09-01');
  });
});

describe('FiscalAgendadorService.conferenciaDiaria', () => {
  function montar(emAndamento: boolean, executar = jest.fn().mockResolvedValue({})) {
    const prisma = { workspace: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ws-1' }) } };
    const sync = {
      status: jest.fn().mockReturnValue({ emAndamento }),
      executar,
      conferirRecebidas: jest.fn().mockResolvedValue({}),
    };
    return { service: new FiscalAgendadorService(prisma as never, sync as never), sync };
  }

  it('roda a carga incremental a partir do mês anterior', async () => {
    const { service, sync } = montar(false);
    await service.conferenciaDiaria();
    expect(sync.executar).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', role: 'owner' }),
      { desde: expect.stringMatching(/^\d{4}-\d{2}-01$/) },
    );
  });

  it('pula quando já tem carga rodando', async () => {
    const { service, sync } = montar(true);
    await service.conferenciaDiaria();
    expect(sync.executar).not.toHaveBeenCalled();
  });

  it('não derruba o processo quando a carga falha', async () => {
    const { service } = montar(false, jest.fn().mockRejectedValue(new Error('eGestor fora do ar')));
    await expect(service.conferenciaDiaria()).resolves.toBeUndefined();
  });

  it('de hora em hora confere só as NF-e recebidas, a partir do mês anterior', async () => {
    const { service, sync } = montar(false);
    await service.conferenciaRecebidas();
    expect(sync.executar).not.toHaveBeenCalled();
    expect(sync.conferirRecebidas).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', role: 'owner' }),
      { desde: expect.stringMatching(/^\d{4}-\d{2}-01$/) },
    );
  });

  it('a de hora em hora também pula quando já tem carga rodando', async () => {
    const { service, sync } = montar(true);
    await service.conferenciaRecebidas();
    expect(sync.conferirRecebidas).not.toHaveBeenCalled();
  });
});
