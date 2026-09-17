import { IsBoolean } from 'class-validator';

// Baixa (ou reabertura) da pendência de quem foi destacado num
// comentário do card de Oportunidade (2026-09-14).
export class MentionDoneDto {
  @IsBoolean()
  resolvida!: boolean;
}
