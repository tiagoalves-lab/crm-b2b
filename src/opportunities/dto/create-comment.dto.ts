import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ITEM_NAME_MAX, ITEMS_MAX } from '../opportunity-tags';

export class CreateCommentDto {
  @IsString()
  @MaxLength(4000)
  body!: string;

  // Carimbo de itens da oportunidade (2026-09-04) — cada tag precisa ser
  // um item da lista lateral do card; checado no service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(ITEM_NAME_MAX, { each: true })
  tags?: string[];

  // Membros destacados no comentário (2026-09-14) — cada um ganha uma
  // pendência no card até dar baixa. Precisam ser membros ativos do
  // workspace; checado no service.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  mentions?: string[];
}
