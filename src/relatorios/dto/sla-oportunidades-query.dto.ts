import { IsISO8601, IsOptional, IsUUID, MaxLength } from 'class-validator';

// Relatório "SLA de Oportunidades" (tela Relatórios, 2026-10-28). Período
// é dia civil de Brasília e se refere à ABERTURA da oportunidade.
export class SlaOportunidadesQueryDto {
  @IsISO8601({ strict: true })
  @MaxLength(10)
  inicio!: string;

  @IsISO8601({ strict: true })
  @MaxLength(10)
  fim!: string;

  // Responsável pela oportunidade. Só estreita o que o papel já enxerga.
  @IsOptional()
  @IsUUID()
  usuarioId?: string;
}
