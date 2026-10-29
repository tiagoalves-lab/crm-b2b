import { IsString, MaxLength } from 'class-validator';

// Edição do texto de um comentário do card (2026-10-16). Só o texto:
// carimbo de itens e destaque de membro têm as próprias rotas. Mesmo teto
// do cadastro (CreateCommentDto).
export class UpdateCommentDto {
  @IsString()
  @MaxLength(4000)
  body!: string;
}
