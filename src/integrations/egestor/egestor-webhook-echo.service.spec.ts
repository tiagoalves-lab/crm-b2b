import { EgestorWebhookEchoService } from './egestor-webhook-echo.service';

describe('EgestorWebhookEchoService', () => {
  describe('registrar', () => {
    it('cria um marcador por par (estabelecimento, codigo) com expiresAt no futuro', async () => {
      const createMany = jest.fn().mockResolvedValue({ count: 2 });
      const tx = {
        egestorWriteEcho: { createMany },
      } as unknown as Parameters<EgestorWebhookEchoService['registrar']>[0];
      const service = new EgestorWebhookEchoService();
      const antes = Date.now();

      await service.registrar(tx, 'ws-1', [
        { estabelecimento: 'matriz', codigo: '109' },
        { estabelecimento: 'filial', codigo: '5' },
      ]);

      expect(createMany).toHaveBeenCalledTimes(1);
      const { data } = createMany.mock.calls[0][0];
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        workspaceId: 'ws-1',
        estabelecimento: 'matriz',
        codigo: '109',
      });
      expect(data[0].expiresAt.getTime()).toBeGreaterThan(antes);
      expect(data[1]).toMatchObject({
        workspaceId: 'ws-1',
        estabelecimento: 'filial',
        codigo: '5',
      });
    });

    it('não chama o banco se a lista de pares for vazia', async () => {
      const createMany = jest.fn();
      const tx = {
        egestorWriteEcho: { createMany },
      } as unknown as Parameters<EgestorWebhookEchoService['registrar']>[0];
      const service = new EgestorWebhookEchoService();

      await service.registrar(tx, 'ws-1', []);

      expect(createMany).not.toHaveBeenCalled();
    });
  });

  describe('consumirSeEco', () => {
    it('devolve true e apaga o marcador quando existe e não expirou', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'echo-1',
        expiresAt: new Date(Date.now() + 10_000),
      });
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const del = jest.fn().mockResolvedValue({});
      const tx = {
        egestorWriteEcho: { findFirst, deleteMany, delete: del },
      } as unknown as Parameters<EgestorWebhookEchoService['consumirSeEco']>[0];
      const service = new EgestorWebhookEchoService();

      const resultado = await service.consumirSeEco(
        tx,
        'ws-1',
        'matriz',
        '109',
      );

      expect(resultado).toBe(true);
      expect(del).toHaveBeenCalledWith({ where: { id: 'echo-1' } });
    });

    it('devolve false quando não existe marcador (edição legítima, não eco)', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const del = jest.fn();
      const tx = {
        egestorWriteEcho: { findFirst, deleteMany, delete: del },
      } as unknown as Parameters<EgestorWebhookEchoService['consumirSeEco']>[0];
      const service = new EgestorWebhookEchoService();

      const resultado = await service.consumirSeEco(
        tx,
        'ws-1',
        'matriz',
        '999',
      );

      expect(resultado).toBe(false);
      expect(del).not.toHaveBeenCalled();
    });

    it('ignora marcador expirado (devolve false) e limpa expirados do mesmo código', async () => {
      // findFirst já filtra expiresAt > agora na query — simula não achando nada.
      const findFirst = jest.fn().mockResolvedValue(null);
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const del = jest.fn();
      const tx = {
        egestorWriteEcho: { findFirst, deleteMany, delete: del },
      } as unknown as Parameters<EgestorWebhookEchoService['consumirSeEco']>[0];
      const service = new EgestorWebhookEchoService();

      const resultado = await service.consumirSeEco(tx, 'ws-1', 'filial', '5');

      expect(resultado).toBe(false);
      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws-1',
          estabelecimento: 'filial',
          codigo: '5',
          expiresAt: { lte: expect.any(Date) },
        },
      });
    });
  });
});
