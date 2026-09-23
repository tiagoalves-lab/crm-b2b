import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Subtipos que o AddNoteForm grava em payload.subtipo (mesmo vocabulário
// do protótipo, ver ActivityService). "Todos" = campo ausente.
export const SUBTIPOS_ANOTACAO = [
  'nota',
  'ligacao',
  'reuniao',
  'visita',
  'email',
  'posvenda',
] as const;
export type SubtipoAnotacao = (typeof SUBTIPOS_ANOTACAO)[number];

// Relatório "Anotações da Timeline" (tela Relatórios, 2026-09-23).
// Período é dia civil de Brasília — o serviço converte para instante.
export class AnotacoesQueryDto {
  @IsISO8601({ strict: true })
  @MaxLength(10)
  inicio!: string;

  @IsISO8601({ strict: true })
  @MaxLength(10)
  fim!: string;

  @IsOptional()
  @IsIn(SUBTIPOS_ANOTACAO)
  subtipo?: SubtipoAnotacao;

  // Quem registrou a anotação (auth.users.id do membro escolhido no
  // filtro). Não amplia acesso nenhum: só estreita o que o papel já
  // enxerga.
  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  empresa?: string;
}
