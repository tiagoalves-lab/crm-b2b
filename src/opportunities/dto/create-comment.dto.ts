import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
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
}
