import {
  resolveRazaoSocial,
  sanitizeRazaoSocial,
} from './sanitize-razao-social';

describe('sanitizeRazaoSocial', () => {
  it('detecta e remove o sufixo sem acento', () => {
    expect(
      sanitizeRazaoSocial(
        'ORTOBRAS INDUSTRIA E COMERCIO DE ORTOPEDIA LTDA EM RECUPERACAO JUDICIAL',
      ),
    ).toEqual({
      razaoSocial: 'ORTOBRAS INDUSTRIA E COMERCIO DE ORTOPEDIA LTDA',
      emRecuperacaoJudicial: true,
    });
  });

  it('detecta com acento e separador por hífen', () => {
    expect(
      sanitizeRazaoSocial('EMPRESA XYZ EIRELI - EM RECUPERAÇÃO JUDICIAL'),
    ).toEqual({
      razaoSocial: 'EMPRESA XYZ EIRELI',
      emRecuperacaoJudicial: true,
    });
  });

  it('não altera razão social sem o indicativo', () => {
    expect(sanitizeRazaoSocial('EMPRESA NORMAL LTDA')).toEqual({
      razaoSocial: 'EMPRESA NORMAL LTDA',
      emRecuperacaoJudicial: false,
    });
  });

  it('é indiferente a caixa (case-insensitive)', () => {
    expect(
      sanitizeRazaoSocial('empresa xyz ltda em recuperacao judicial'),
    ).toEqual({
      razaoSocial: 'empresa xyz ltda',
      emRecuperacaoJudicial: true,
    });
  });

  it('mantém o texto original se sobrar vazio depois de remover o sufixo', () => {
    expect(sanitizeRazaoSocial('EM RECUPERACAO JUDICIAL')).toEqual({
      razaoSocial: 'EM RECUPERACAO JUDICIAL',
      emRecuperacaoJudicial: true,
    });
  });
});

describe('resolveRazaoSocial', () => {
  it('confia no hint quando informado, sem tentar detectar de novo', () => {
    expect(resolveRazaoSocial('EMPRESA JÁ LIMPA LTDA', true)).toEqual({
      razaoSocial: 'EMPRESA JÁ LIMPA LTDA',
      emRecuperacaoJudicial: true,
    });
  });

  it('autodetecta quando não há hint', () => {
    expect(resolveRazaoSocial('EMPRESA LTDA EM RECUPERACAO JUDICIAL')).toEqual({
      razaoSocial: 'EMPRESA LTDA',
      emRecuperacaoJudicial: true,
    });
  });
});
