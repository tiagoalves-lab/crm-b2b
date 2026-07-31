import { Injectable } from '@nestjs/common';

export interface ScoreInput {
  cnaePrincipal?: string | null;
  importador: boolean;
  porte?: string | null;
  situacao?: string | null;
  uf?: string | null;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export type ScoreTier = 'quente' | 'morno' | 'frio';

// Espelha 1:1 a função scoreRaw() do protótipo (gama-crm-mvp.html, ~linha
// 694) — fórmula de qualificação da Gama pra metalmecânica/RS. `porte` e
// `situacao` são comparados por igualdade de string exata (GRANDE/MÉDIO/
// PEQUENO, ATIVA/...) porque é assim que o crawler normaliza — nenhum
// enum novo no banco pra isso (são campos `text` em raw_leads).
@Injectable()
export class LeadScoringService {
  score(input: ScoreInput): ScoreResult {
    let score = 0;
    const reasons: string[] = [];

    // CNAE aderente (divisões 25–30 = metalmecânica alvo).
    const div = parseInt((input.cnaePrincipal ?? '').slice(0, 2), 10);
    if (div >= 25 && div <= 30) {
      score += 40;
      reasons.push('CNAE alvo (25–30) +40');
    } else if (div === 24) {
      score += 20;
      reasons.push('CNAE metalurgia próxima +20');
    } else {
      reasons.push('CNAE fora do alvo +0');
    }

    // Importador (Comex Stat) — sinal forte de capital.
    if (input.importador) {
      score += 25;
      reasons.push('Importa via Comex Stat +25');
    } else {
      reasons.push('Não importa +0');
    }

    // Porte.
    if (input.porte === 'GRANDE') {
      score += 20;
      reasons.push('Porte grande +20');
    } else if (input.porte === 'MÉDIO') {
      score += 13;
      reasons.push('Porte médio +13');
    } else {
      score += 5;
      reasons.push('Porte pequeno +5');
    }

    // Situação cadastral ativa.
    if (input.situacao === 'ATIVA') {
      score += 10;
      reasons.push('Situação ativa +10');
    } else {
      score -= 20;
      reasons.push('Situação irregular −20');
    }

    // Região RS (todos são, mas mantém a lógica explícita do protótipo).
    if (input.uf === 'RS') {
      score += 5;
      reasons.push('Região RS +5');
    }

    return { score: Math.max(0, Math.min(100, score)), reasons };
  }

  tier(score: number): ScoreTier {
    if (score >= 70) return 'quente';
    if (score >= 45) return 'morno';
    return 'frio';
  }
}
