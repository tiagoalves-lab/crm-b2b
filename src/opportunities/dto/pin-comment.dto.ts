import { IsBoolean } from 'class-validator';

// Fixar/desafixar comentário do card de Oportunidade (2026-09-09).
export class PinCommentDto {
  @IsBoolean()
  pinned!: boolean;
}
