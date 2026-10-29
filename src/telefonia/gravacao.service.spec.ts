import type { TenantTx } from '../tenancy/tenant-context.service';
import {
  casarComChamada,
  lerNomeDaGravacao,
  pareceAudio,
} from './gravacao.service';

const device = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
};

describe('lerNomeDaGravacao', () => {
  it('extrai data (Brasília → UTC) e número do padrão do MicroSIP', () => {
    const nome = lerNomeDaGravacao(
      '20261027-143005-5551999998888-outgoing-Gama_SDR.mp3',
    );
    expect(nome.formato).toBe('mp3');
    expect(nome.telefone).toBe('5551999998888');
    expect(nome.gravadoEm?.toISOString()).toBe('2026-10-27T17:30:05.000Z');
  });

  it('aceita chamada recebida e WAV', () => {
    const nome = lerNomeDaGravacao(
      '20261027-090000-05532201234-incoming-4130.wav',
    );
    expect(nome.formato).toBe('wav');
    expect(nome.telefone).toBe('05532201234');
  });

  it('nome fora do padrão ainda entra, só sem data e número', () => {
    const nome = lerNomeDaGravacao('gravacao_manual.mp3');
    expect(nome).toEqual({ formato: 'mp3', gravadoEm: null, telefone: null });
  });

  it('número curto demais (ramal) não vira telefone', () => {
    expect(
      lerNomeDaGravacao('20261027-090000-201-outgoing-x.mp3').telefone,
    ).toBeNull();
  });
});

describe('pareceAudio', () => {
  it('reconhece MP3 com ID3 e com sincronismo de quadro', () => {
    expect(pareceAudio(Buffer.from('ID3\x04\x00'), 'mp3')).toBe(true);
    expect(pareceAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00]), 'mp3')).toBe(
      true,
    );
  });

  it('recusa texto disfarçado de MP3', () => {
    expect(pareceAudio(Buffer.from('<html>oi</html>'), 'mp3')).toBe(false);
  });

  it('reconhece WAV pelo cabeçalho RIFF/WAVE', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WAVE'),
    ]);
    expect(pareceAudio(wav, 'wav')).toBe(true);
    expect(pareceAudio(Buffer.from('RIFF0000AVI '), 'wav')).toBe(false);
  });
});

describe('casarComChamada', () => {
  const gravadoEm = new Date('2026-10-27T17:30:05.000Z');

  function txCom(chamadas: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(chamadas);
    return { tx: { call: { findMany } } as unknown as TenantTx, findMany };
  }

  it('casa pelos últimos 8 dígitos e escolhe o atendimento mais próximo', async () => {
    const { tx, findMany } = txCom([
      {
        id: 'longe',
        telefone: '5551999998888',
        atendidaEm: new Date('2026-10-27T17:32:30.000Z'),
        iniciadaEm: new Date('2026-10-27T17:32:00.000Z'),
      },
      {
        id: 'perto',
        telefone: '5551999998888',
        atendidaEm: new Date('2026-10-27T17:30:03.000Z'),
        iniciadaEm: new Date('2026-10-27T17:29:50.000Z'),
      },
      {
        id: 'outro-numero',
        telefone: '5551977776666',
        atendidaEm: new Date('2026-10-27T17:30:05.000Z'),
        iniciadaEm: new Date('2026-10-27T17:30:00.000Z'),
      },
    ]);

    // MicroSIP mandou com prefixo de operadora: só os 8 finais contam.
    const id = await casarComChamada(tx, device, '0155199998888', gravadoEm);
    expect(id).toBe('perto');

    // A busca é sempre da própria pessoa, nunca do workspace inteiro.
    const where = findMany.mock.calls[0][0].where;
    expect(where.userId).toBe(device.userId);
    expect(where.workspaceId).toBe(device.workspaceId);
  });

  it('nenhuma ligação daquele número: gravação fica sem ligação', async () => {
    const { tx } = txCom([
      {
        id: 'outro-numero',
        telefone: '5551977776666',
        atendidaEm: gravadoEm,
        iniciadaEm: gravadoEm,
      },
    ]);
    expect(
      await casarComChamada(tx, device, '5551999998888', gravadoEm),
    ).toBeNull();
  });
});
