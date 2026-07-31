import { Type } from 'class-transformer';
import type { RawLeadStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const STATUSES: RawLeadStatus[] = ['novo', 'aprovado', 'descartado'];
const TIERS = ['quente', 'morno', 'frio'] as const;
export type ScoreTierFilter = (typeof TIERS)[number];

export class ListRawLeadsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;

  // Default 'novo' aplicado no service — é a fila de triagem (a maioria
  // das consultas é essa); aprovado/descartado servem pra auditoria.
  @IsOptional()
  @IsIn(STATUSES)
  status?: RawLeadStatus;

  @IsOptional()
  @IsIn(TIERS)
  tier?: ScoreTierFilter;

  // Busca por razão social ou CNAE (ILIKE no service).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;
}
