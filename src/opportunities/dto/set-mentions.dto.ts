import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

// Destacar/tirar destaque de membros num comentário já publicado
// (2026-09-14) — a lista chega inteira e substitui a anterior.
export class SetMentionsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  mentions!: string[];
}
