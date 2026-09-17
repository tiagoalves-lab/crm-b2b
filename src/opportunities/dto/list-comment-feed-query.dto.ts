import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

// Histórico de anotações do Pipeline (2026-09-09) — GET
// /opportunity-comments. Só a janela dos recentes é limitada; comentário
// fixado vem sempre inteiro (ver OpportunityCommentService#feed).
export class ListCommentFeedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  // Só os fixados (2026-09-14) — a barra da tela Pipeline usa isso pra
  // dizer quantas anotações estão fixadas sem baixar o feed inteiro.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  apenasFixados?: boolean;
}
