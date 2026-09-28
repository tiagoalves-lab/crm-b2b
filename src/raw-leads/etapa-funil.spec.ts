import { etapaAvancada, etapaDoSubtipo, ordemDaEtapa } from './etapa-funil';

// A régua do funil de prospecção (2026-09-23). O que importa aqui é a
// propriedade que o resto do código assume: avanço automático só empurra
// pra frente. Quem puxa o cartão pra trás é a pessoa, arrastando no
// quadro (RawLeadService#setEtapa).
describe('etapa-funil', () => {
  it('ordena as etapas na sequência do funil', () => {
    expect(ordemDaEtapa('entrada')).toBeLessThan(ordemDaEtapa('andamento'));
    expect(ordemDaEtapa('andamento')).toBeLessThan(ordemDaEtapa('reuniao'));
    expect(ordemDaEtapa('reuniao')).toBeLessThan(ordemDaEtapa('qualificado'));
    expect(ordemDaEtapa('qualificado')).toBeLessThan(
      ordemDaEtapa('negociacao'),
    );
  });

  it('avança quando o alvo está à frente', () => {
    expect(etapaAvancada('entrada', 'reuniao')).toBe('reuniao');
    expect(etapaAvancada('andamento', 'qualificado')).toBe('qualificado');
  });

  it('nunca retrocede', () => {
    // Um lead já qualificado que recebe mais uma ligação continua
    // qualificado — foi o caso que motivou a função existir.
    expect(etapaAvancada('qualificado', 'andamento')).toBe('qualificado');
    expect(etapaAvancada('negociacao', 'reuniao')).toBe('negociacao');
    expect(etapaAvancada('reuniao', 'reuniao')).toBe('reuniao');
  });

  it('mapeia o registro da Timeline para a etapa que ele comprova', () => {
    expect(etapaDoSubtipo('reuniao')).toBe('reuniao');
    for (const subtipo of ['nota', 'ligacao', 'visita', 'email']) {
      expect(etapaDoSubtipo(subtipo)).toBe('andamento');
    }
  });

  it('ignora registro sem subtipo ou de tipo que não é interação', () => {
    // Registro automático de auditoria (empresa criada/cadastro
    // atualizado) não tem subtipo — não pode mover lead nenhum.
    expect(etapaDoSubtipo(undefined)).toBeNull();
    expect(etapaDoSubtipo('posvenda')).toBeNull();
  });
});
