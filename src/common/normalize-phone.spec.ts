import { normalizarTelefone, variantesDeBusca } from './normalize-phone';

// A base real tem telefone digitado à mão vindo de quatro origens
// (planilha, Receita, eGestor, Meta) — estes casos são os formatos que
// aparecem de verdade nela.
describe('normalizarTelefone', () => {
  it.each([
    ['(55) 3220-1234', '555532201234'],
    ['55 99999-8888', '5555999998888'],
    ['+55 51 99999-8888', '5551999998888'],
    ['5551999998888', '5551999998888'],
    ['51 3333 4444', '555133334444'],
    ['0800 123 4567', '08001234567'],
  ])('%s vira %s', (entrada, esperado) => {
    expect(normalizarTelefone(entrada).e164).toBe(esperado);
  });

  it('recusa número sem DDD válido em vez de tentar discar', () => {
    expect(normalizarTelefone('(00) 99999-8888')).toEqual({
      e164: null,
      motivo: 'ddd-invalido',
    });
  });

  it('recusa número incompleto', () => {
    expect(normalizarTelefone('3220-1234').motivo).toBe('curto');
  });

  it('recusa campo vazio', () => {
    expect(normalizarTelefone('').motivo).toBe('vazio');
    expect(normalizarTelefone(null).motivo).toBe('vazio');
  });

  it('recusa número internacional — a linha da Gama disca só para o Brasil', () => {
    expect(normalizarTelefone('+1 415 555 2671').motivo).toBe(
      'internacional-nao-suportado',
    );
  });
});

describe('variantesDeBusca', () => {
  // O evento que volta da máquina do SDR traz o número como foi DISCADO,
  // que nem sempre é como está no cadastro — sem as variantes, a ligação
  // não casaria com a empresa certa.
  it('cobre com e sem código do país', () => {
    expect(variantesDeBusca('5551999998888')).toEqual(
      expect.arrayContaining(['5551999998888', '51999998888']),
    );
  });

  it('cobre celular de 8 e de 9 dígitos (a base tem os dois)', () => {
    const variantes = variantesDeBusca('5551999998888');
    expect(variantes).toEqual(expect.arrayContaining(['555199998888', '5199998888']));
  });
});
