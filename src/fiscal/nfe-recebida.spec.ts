import {
  acaoNfeRecebida,
  gravarNfeRecebida,
  partesDaChave,
  situacaoNfeRecebida,
  type NfeRecebidaGravada,
  type NfeRecebidaLista,
} from './nfe-recebida';
import { decimal } from './fiscal-notas-sync.service';

// Chave fictícia: UF 35, 2610, CNPJ zerado, modelo 55, série 001, nº 000004321.
const CHAVE = '35261000000000000000550010000043211000043210';

function nota(extra: Partial<NfeRecebidaLista> = {}): NfeRecebidaLista & { chave: string } {
  return {
    codigo: 10,
    chave: CHAVE,
    situacao: 1,
    manifesto: '210210',
    temXML: '<?xml vers',
    temCompra: '0',
    cnpjEmit: '00000000000000',
    nomeEmit: 'Fornecedor Ficticio',
    cnpjDest: '11111111000111',
    valorTotal: '150.00',
    dtEmissao: '2026-10-10 09:00:00',
    ...extra,
  } as NfeRecebidaLista & { chave: string };
}

function gravada(extra: Partial<NfeRecebidaGravada> = {}): NfeRecebidaGravada {
  return {
    chave: CHAVE,
    codEgestor: 10,
    situacaoEgestor: 1,
    manifesto: '210210',
    lancadaCompra: false,
    temXml: true,
    ...extra,
  };
}

describe('acaoNfeRecebida', () => {
  it('nota nova com arquivo no eGestor: baixa o XML', () => {
    expect(acaoNfeRecebida(nota(), undefined)).toBe('baixar_xml');
  });

  it('nota nova só com o resumo (sem ciência): grava o resumo, sem pedir arquivo', () => {
    expect(acaoNfeRecebida(nota({ temXML: '' }), undefined)).toBe('atualizar_resumo');
  });

  it('nada mudou: não faz nada', () => {
    expect(acaoNfeRecebida(nota(), gravada())).toBe('nada');
  });

  it('foi cancelada: baixa o XML de novo', () => {
    expect(acaoNfeRecebida(nota({ situacao: 3 }), gravada())).toBe('baixar_xml');
  });

  it('passou a ter o arquivo (alguém deu ciência no eGestor): baixa o XML', () => {
    expect(acaoNfeRecebida(nota(), gravada({ temXml: false }))).toBe('baixar_xml');
  });

  it('só mudou a manifestação ou o lançamento como compra: atualiza o resumo', () => {
    expect(acaoNfeRecebida(nota({ manifesto: '210200' }), gravada())).toBe('atualizar_resumo');
    expect(acaoNfeRecebida(nota({ temCompra: '1' }), gravada())).toBe('atualizar_resumo');
  });
});

describe('helpers', () => {
  it('lê modelo, série e número da chave', () => {
    expect(partesDaChave(CHAVE)).toEqual({ modelo: 55, serie: 1, numero: 4321 });
    expect(partesDaChave('123')).toBeNull();
  });

  it('traduz a situação da SEFAZ', () => {
    expect(situacaoNfeRecebida(1)).toBe('autorizada');
    expect(situacaoNfeRecebida(2)).toBe('denegada');
    expect(situacaoNfeRecebida(3)).toBe('cancelada');
  });
});

describe('gravarNfeRecebida', () => {
  function tx() {
    return {
      fiscalNfeRecebida: { upsert: jest.fn().mockResolvedValue({ id: 'r-1' }) },
      fiscalNfeRecebidaItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
  }
  const daLista = { data: '2026-10-10', instante: new Date('2026-10-10T12:00:00Z') };

  it('nota só com resumo: tira número/série da chave e grava valor e fornecedor da listagem', async () => {
    const t = tx();
    await gravarNfeRecebida(t as never, {
      workspaceId: 'ws',
      estabelecimento: 'filial',
      nota: nota({ temXML: '' }),
      preservarArquivo: false,
      xml: null,
      lida: null,
      daLista,
      decimal,
    });
    const { create } = t.fiscalNfeRecebida.upsert.mock.calls[0][0];
    expect(create).toMatchObject({
      origem: 'egestor:/v1/nfe/recebidas',
      chave: CHAVE,
      numero: 4321,
      serie: 1,
      modelo: 55,
      situacao: 'autorizada',
      emitNome: 'Fornecedor Ficticio',
      vNf: '150.00',
      manifesto: '210210',
      lancadaCompra: false,
    });
    expect(t.fiscalNfeRecebidaItem.createMany).not.toHaveBeenCalled();
  });

  it('nota já com arquivo que só mudou o resumo: não apaga totais nem itens', async () => {
    const t = tx();
    await gravarNfeRecebida(t as never, {
      workspaceId: 'ws',
      estabelecimento: 'matriz',
      nota: nota({ temCompra: '1' }),
      preservarArquivo: true,
      xml: null,
      lida: null,
      daLista,
      decimal,
    });
    const { update } = t.fiscalNfeRecebida.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ lancadaCompra: true });
    expect(update).not.toHaveProperty('vNf');
    expect(update).not.toHaveProperty('xml');
    expect(t.fiscalNfeRecebidaItem.deleteMany).not.toHaveBeenCalled();
  });
});
