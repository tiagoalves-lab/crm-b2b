import type { RawLeadEtapa } from '@prisma/client';
import { IsIn } from 'class-validator';
import { ETAPAS_FUNIL } from '../etapa-funil';

// Mover o lead de etapa no quadro da Prospecção (2026-09-23) — é o que o
// arrasto do cartão grava. Obrigatório (não @IsOptional): quem chama
// sempre declara a etapa de destino.
export class UpdateLeadEtapaDto {
  @IsIn(ETAPAS_FUNIL)
  etapa!: RawLeadEtapa;
}
