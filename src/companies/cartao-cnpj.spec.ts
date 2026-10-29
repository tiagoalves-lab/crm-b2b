import { camposDoLeadPeloCartaoCnpj } from './cartao-cnpj';

describe('camposDoLeadPeloCartaoCnpj', () => {
  const cartao = {
    situacaoCadastral: 'ATIVA',
    porte: 'MICRO EMPRESA',
    cnaePrincipal: '2532201 - Produção de artefatos estampados de metal',
    buscadoEm: '2026-10-26T11:40:12.887Z',
  };

  it('traduz o cartão pro formato do lead', () => {
    expect(camposDoLeadPeloCartaoCnpj(cartao, undefined)).toEqual({
      cnaePrincipal: '2532201',
      cnaeDescricao: 'PRODUÇÃO DE ARTEFATOS ESTAMPADOS DE METAL',
      porte: 'PEQUENO',
      situacao: 'ATIVA',
    });
  });

  it('não mexe no lead quando o cartão é o mesmo que a empresa já tinha', () => {
    expect(camposDoLeadPeloCartaoCnpj(cartao, { ...cartao })).toEqual({});
  });

  it('consulta nova sobre cartão antigo espelha', () => {
    const antigo = { ...cartao, buscadoEm: '2026-08-13T10:00:00.000Z' };
    expect(camposDoLeadPeloCartaoCnpj(cartao, antigo)).toMatchObject({
      cnaePrincipal: '2532201',
    });
  });

  it('porte e situação fora da régua ficam de fora', () => {
    expect(
      camposDoLeadPeloCartaoCnpj(
        { porte: 'DEMAIS', situacaoCadastral: '2', buscadoEm: 'x' },
        undefined,
      ),
    ).toEqual({ porte: 'MÉDIO' });
  });

  it('sem cartão no update, nada', () => {
    expect(camposDoLeadPeloCartaoCnpj(undefined, cartao)).toEqual({});
  });
});
