import { EgestorInteractionLogService } from './egestor-interaction-log.service';

function fakeTx() {
  const egestorInteractionLog = {
    create: jest.fn().mockResolvedValue(undefined),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const tx = { egestorInteractionLog } as unknown as Parameters<
    EgestorInteractionLogService['registrar']
  >[0];
  return { tx, egestorInteractionLog };
}

describe('EgestorInteractionLogService', () => {
  it('registrar grava origem/action/summary escopados ao workspace', async () => {
    const { tx, egestorInteractionLog } = fakeTx();
    const service = new EgestorInteractionLogService();

    await service.registrar(tx, 'ws-1', {
      origin: 'crm',
      action: 'promover_contatos',
      summary: 'Promoção manual disparada.',
    });

    expect(egestorInteractionLog.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        origin: 'crm',
        action: 'promover_contatos',
        summary: 'Promoção manual disparada.',
      },
    });
  });

  it('listar busca por workspace, mais recente primeiro', async () => {
    const { tx, egestorInteractionLog } = fakeTx();
    const service = new EgestorInteractionLogService();

    await service.listar(tx, 'ws-1');

    expect(egestorInteractionLog.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      orderBy: { occurredAt: 'desc' },
    });
  });
});
