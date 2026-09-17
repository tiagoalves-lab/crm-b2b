import { IsBoolean } from 'class-validator';

// Marca (ou desmarca) uma anotação como lida no histórico de anotações do
// Pipeline (2026-09-17). Vale só pra quem chamou.
export class CommentReadDto {
  @IsBoolean()
  lido!: boolean;
}
