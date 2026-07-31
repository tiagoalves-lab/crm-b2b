import { LeadScoringService } from './lead-scoring.service';

// Casos espelham exatamente scoreRaw()/scoreTier() do protótipo
// (gama-crm-mvp.html, ~linha 694) — qualquer mudança de comportamento
// aqui é uma mudança de critério de negócio, não só refactor.
describe('LeadScoringService', () => {
  const scoring = new LeadScoringService();

  it('soma todos os critérios positivos (CNAE alvo + importador + porte grande + ativa + RS = 100)', () => {
    const { score } = scoring.score({
      cnaePrincipal: '2511-0',
      importador: true,
      porte: 'GRANDE',
      situacao: 'ATIVA',
      uf: 'RS',
    });
    expect(score).toBe(100);
  });

  it('CNAE de metalurgia próxima (divisão 24) soma só +20, não +40', () => {
    const { score } = scoring.score({
      cnaePrincipal: '2421-1',
      importador: false,
      porte: 'PEQUENO',
      situacao: 'ATIVA',
      uf: 'RS',
    });
    // 20 (cnae) + 0 (não importa) + 5 (pequeno) + 10 (ativa) + 5 (RS) = 40
    expect(score).toBe(40);
  });

  it('CNAE fora do alvo não soma nada', () => {
    const { score } = scoring.score({
      cnaePrincipal: '4663-0',
      importador: false,
      porte: 'PEQUENO',
      situacao: 'ATIVA',
      uf: 'RS',
    });
    // 0 + 0 + 5 + 10 + 5 = 20
    expect(score).toBe(20);
  });

  it('porte médio soma +13', () => {
    const { score } = scoring.score({
      cnaePrincipal: '2829-1',
      importador: false,
      porte: 'MÉDIO',
      situacao: 'ATIVA',
      uf: 'RS',
    });
    // 40 + 0 + 13 + 10 + 5 = 68
    expect(score).toBe(68);
  });

  it('situação irregular subtrai 20 (nunca deixa o score negativo)', () => {
    const { score } = scoring.score({
      cnaePrincipal: null,
      importador: false,
      porte: null,
      situacao: 'BAIXADA',
      uf: 'SC',
    });
    // 0 + 0 + 5 (porte não-GRANDE/MÉDIO cai no branch "pequeno") - 20 = -15 -> clamped a 0
    expect(score).toBe(0);
  });

  it('UF fora do RS não soma o bônus de região', () => {
    const { score } = scoring.score({
      cnaePrincipal: '2599-3',
      importador: false,
      porte: 'MÉDIO',
      situacao: 'ATIVA',
      uf: 'SC',
    });
    // 40 + 0 + 13 + 10 + 0 = 63
    expect(score).toBe(63);
  });

  it('score nunca ultrapassa 100 nem fica negativo', () => {
    const max = scoring.score({
      cnaePrincipal: '2511-0',
      importador: true,
      porte: 'GRANDE',
      situacao: 'ATIVA',
      uf: 'RS',
    });
    expect(max.score).toBeLessThanOrEqual(100);

    const min = scoring.score({
      cnaePrincipal: null,
      importador: false,
      porte: null,
      situacao: 'BAIXADA',
      uf: null,
    });
    expect(min.score).toBeGreaterThanOrEqual(0);
  });

  it('devolve os motivos do cálculo (pra exibição na ficha do lead)', () => {
    const { reasons } = scoring.score({
      cnaePrincipal: '2511-0',
      importador: true,
      porte: 'GRANDE',
      situacao: 'ATIVA',
      uf: 'RS',
    });
    expect(reasons).toContain('CNAE alvo (25–30) +40');
    expect(reasons).toContain('Importa via Comex Stat +25');
    expect(reasons).toContain('Porte grande +20');
    expect(reasons).toContain('Situação ativa +10');
    expect(reasons).toContain('Região RS +5');
  });

  describe('tier', () => {
    it('classifica >=70 como quente', () => {
      expect(scoring.tier(70)).toBe('quente');
      expect(scoring.tier(100)).toBe('quente');
    });

    it('classifica 45-69 como morno', () => {
      expect(scoring.tier(45)).toBe('morno');
      expect(scoring.tier(69)).toBe('morno');
    });

    it('classifica <45 como frio', () => {
      expect(scoring.tier(44)).toBe('frio');
      expect(scoring.tier(0)).toBe('frio');
    });
  });
});
