import { IsIn } from 'class-validator';

// Classificação manual (Quente/Morno/Frio) sobre um lead — sobrepõe o tier
// calculado por LeadScoringService#tier a partir do score. `tier: null`
// limpa a marcação manual e volta a usar o cálculo automático — por isso o
// campo é obrigatório (não @IsOptional): o cliente sempre declara a
// intenção explicitamente, "definir" ou "limpar", nunca "não mandei nada".
export class UpdateLeadTierDto {
  @IsIn(['quente', 'morno', 'frio', null])
  tier!: 'quente' | 'morno' | 'frio' | null;
}
