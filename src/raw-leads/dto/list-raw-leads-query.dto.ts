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

  // Teto levantado de 200 pra 5000 (2026-08-10, achado real): a tela de
  // Prospecção busca tudo numa página só e filtra/ordena no client (sem
  // paginação de verdade), então um teto baixo aqui faz linha de baixo
  // score "sumir" da tela mesmo existindo no banco — foi exatamente o que
  // aconteceu com uma importação de planilha sem CNAE/porte (876 CNPJs,
  // todos pontuando "frio", nenhum dos além do 200º aparecia). Mesmo
  // contrato pros badges de contagem (layout.tsx/painel/relatórios), que
  // sofriam o mesmo corte silencioso.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
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
