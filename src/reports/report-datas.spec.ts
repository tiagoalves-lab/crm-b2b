import {
  diaComSemanaCurto,
  diaDoPrazo,
  diasEntre,
  domingoDaSemana,
} from './report-datas';

describe('datas do report', () => {
  it('prazo só-data vale o dia digitado, não a véspera em Brasília', () => {
    // <input type="date"> com 22/10 é gravado como meia-noite UTC — 21h do
    // dia 21 em Brasília. Era o "1 dia atrasada" de tarefa que vence hoje.
    expect(diaDoPrazo(new Date('2026-10-22T00:00:00.000Z'), false)).toBe(
      '2026-10-22',
    );
  });

  it('prazo com hora vale o dia em Brasília', () => {
    // Reunião às 22h de 22/10 em Brasília = 01h de 23/10 em UTC.
    expect(diaDoPrazo(new Date('2026-10-23T01:00:00.000Z'), true)).toBe(
      '2026-10-22',
    );
  });

  it('semana fecha no domingo (W0 de segunda a domingo)', () => {
    expect(domingoDaSemana('2026-10-19')).toBe('2026-10-25'); // segunda
    expect(domingoDaSemana('2026-10-22')).toBe('2026-10-25'); // quinta
    expect(domingoDaSemana('2026-10-25')).toBe('2026-10-25'); // domingo
  });

  it('conta dias e formata o dia com a semana', () => {
    expect(diasEntre('2026-10-20', '2026-10-22')).toBe(2);
    expect(diasEntre('2026-10-31', '2026-11-01')).toBe(1);
    expect(diaComSemanaCurto('2026-10-27')).toBe('ter 27/10');
  });
});
