import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ITEM_NAME_MAX } from '../opportunity-tags';

// Um item da lista lateral do card de Oportunidade (2026-09-04).
// Posição é calculada no service (fim da lista). O valor é opcional:
// item sem valor continua servindo só de rótulo pra carimbar
// comentário e tarefa.
export class CreateItemDto {
  @IsString()
  @MaxLength(ITEM_NAME_MAX)
  name!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
}
