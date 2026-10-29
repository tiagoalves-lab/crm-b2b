import { IsIn, IsUUID } from 'class-validator';

// Etapas que o app de cotações pode pedir. Chave curta e estável em vez do
// nome do estágio: o nome é do CRM (pode ser renomeado aqui) e o app não
// deve depender dele.
//  • "aprovacao" (2026-10-08) — orçamento vinculado ao card e em "Aguardando
//    aprovação" leva o card para Aprovação de Propostas;
//  • "aprovadas" (2026-10-28) — PDF da proposta entregue no card leva o card
//    de Aprovação de Propostas para Propostas aprovadas.
export const ETAPAS_COTACOES = ['aprovacao', 'aprovadas'] as const;
export type EtapaCotacoes = (typeof ETAPAS_COTACOES)[number];

export class AvancarEstagioDto {
  @IsUUID()
  opportunity_id!: string;

  @IsIn(ETAPAS_COTACOES)
  etapa!: EtapaCotacoes;
}
