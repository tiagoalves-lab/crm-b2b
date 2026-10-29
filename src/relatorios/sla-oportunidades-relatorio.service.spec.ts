import { montarHistograma } from './sla-oportunidades-relatorio.service';

const itens = (dias: number[], pendentes: number[] = []) =>
  dias.map((d, i) => ({ dias: d, pendente: pendentes.includes(i) }));

describe('montarHistograma (relatório SLA de Oportunidades)', () => {
  it('sem oportunidades devolve histograma vazio e resumo nulo', () => {
    const { faixas, resumo } = montarHistograma([]);
    expect(faixas).toEqual([]);
    expect(resumo.total).toBe(0);
    expect(resumo.mediana).toBeNull();
    expect(resumo.diasNoCorte).toBeNull();
  });

  it('cria uma faixa por dia de 0 ao máximo, inclusive as vazias', () => {
    const { faixas } = montarHistograma(itens([0, 1, 1, 3]));
    expect(faixas.map((f) => [f.dias, f.total])).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
      [3, 1],
    ]);
  });

  it('conta as pendentes dentro da faixa delas', () => {
    const { faixas, resumo } = montarHistograma(itens([2, 2, 4], [1, 2]));
    expect(faixas[2]).toEqual({ dias: 2, total: 2, pendentes: 1 });
    expect(faixas[4]).toEqual({ dias: 4, total: 1, pendentes: 1 });
    expect(resumo.pendentes).toBe(2);
  });

  it('calcula mediana, média e máximo', () => {
    expect(montarHistograma(itens([1, 3, 2])).resumo).toMatchObject({
      mediana: 2,
      media: 2,
      maximo: 3,
    });
    expect(montarHistograma(itens([1, 2, 3, 4])).resumo.mediana).toBe(2.5);
  });

  it('acha o menor número de dias que cobre 80% (dados do CRM em 2026-10-28)', () => {
    const dias = [
      ...Array(7).fill(0),
      ...Array(12).fill(1),
      ...Array(6).fill(2),
      ...Array(7).fill(3),
      ...Array(6).fill(4),
      ...Array(3).fill(5),
      ...Array(3).fill(7),
      8,
    ];
    const { resumo, faixas } = montarHistograma(itens(dias));
    expect(resumo.total).toBe(45);
    expect(resumo.mediana).toBe(2);
    expect(resumo.media).toBe(2.5);
    expect(resumo.diasNoCorte).toBe(4);
    expect(resumo.ateCorte).toBe(38);
    expect(faixas[6].total).toBe(0);
  });
});
