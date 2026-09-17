import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

// Nova ordem dos cards de uma coluna do quadro (2026-09-14) — a coluna
// inteira, na ordem em que ficou depois do arrasto.
export class ReorderOpportunitiesDto {
  @IsUUID()
  stageId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
