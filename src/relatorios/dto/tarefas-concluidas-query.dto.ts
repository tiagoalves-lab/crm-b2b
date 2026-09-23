import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Mesmos valores do enum TaskType no banco.
export const TIPOS_TAREFA = [
  'ligacao',
  'email',
  'visita',
  'proposta',
  'followup',
  'reuniao',
] as const;
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];

// Relatório "Tarefas concluídas" (tela Relatórios, 2026-09-23). Período é
// dia civil de Brasília e se refere à data de CONCLUSÃO, não ao prazo.
export class TarefasConcluidasQueryDto {
  @IsISO8601({ strict: true })
  @MaxLength(10)
  inicio!: string;

  @IsISO8601({ strict: true })
  @MaxLength(10)
  fim!: string;

  @IsOptional()
  @IsIn(TIPOS_TAREFA)
  tipo?: TipoTarefa;

  // Responsável pela tarefa. Só estreita o que o papel já enxerga.
  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  empresa?: string;
}
