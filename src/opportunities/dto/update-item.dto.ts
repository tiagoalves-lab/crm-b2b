import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ITEM_NAME_MAX } from '../opportunity-tags';

// Edição de um item da lista lateral (2026-09-04). Nasceu por causa do
// valor: dá pra digitar o preço de cada item depois de cadastrar a lista,
// sem apagar e criar de novo. `amount: null` limpa o valor.
export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(ITEM_NAME_MAX)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number | null;
}
