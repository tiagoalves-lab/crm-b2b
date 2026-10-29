import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// Teto de itens por chamada — o mesmo da lista lateral do card (ITEMS_MAX).
export const ITENS_VALOR_MAX = 50;

export class ItemValorDto {
  @IsUUID()
  item_id!: string;

  // Preço de venda da máquina (com os opcionais inclusos dela) na versão do
  // orçamento escolhida como principal no envio. Teto = o que cabe em
  // Decimal(14,2), a coluna de opportunity_items.amount.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999.99)
  amount!: number;
}

// "Enviar proposta ao CRM" (2026-10-08): o app de cotações preenche o valor
// de cada item do card com o preço cotado. Só itens DESTE card — item de
// outro card vira 404, nunca é tocado.
export class ItensValorDto {
  @IsUUID()
  opportunity_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ITENS_VALOR_MAX)
  @ValidateNested({ each: true })
  @Type(() => ItemValorDto)
  itens!: ItemValorDto[];
}
