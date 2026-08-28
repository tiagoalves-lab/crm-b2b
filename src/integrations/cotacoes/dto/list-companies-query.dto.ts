import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

// Query do sync do espelho (gama-webapp, crm_espelho_sync_). `desde` é a
// marca d'água devolvida pelo próprio CRM na varredura anterior (campo
// `agora` da resposta) — nunca o relógio do Apps Script.
export class ListCompaniesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  tamanho?: number;

  @IsOptional()
  @IsISO8601()
  desde?: string;
}
