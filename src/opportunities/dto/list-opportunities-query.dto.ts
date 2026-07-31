import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ListQueryDto } from '../../common/dto/list-query.dto';

export class ListOpportunitiesQueryDto extends ListQueryDto {
  // Oportunidades "open" sem stage_change (ou criação, se nunca mudou de
  // stage) há pelo menos N dias — base do alerta "deal parado" da Fase 4
  // (docs/roadmap.md).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  staleDays?: number;

  // Ficha da empresa (SPEC-CRM-GAMA.md §4.1, aba "Oportunidades").
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
