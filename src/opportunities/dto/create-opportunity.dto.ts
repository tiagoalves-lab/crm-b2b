import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ITEM_NAME_MAX, ITEMS_MAX } from '../opportunity-tags';

export class CreateOpportunityDto {
  @IsUUID()
  companyId!: string;

  @IsUUID()
  pipelineId!: string;

  @IsUUID()
  stageId!: string;

  // Default (não informado): quem está criando. Se informado, precisa ser
  // Membership ativo do mesmo workspace (checado no service).
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @Matches(/^[A-Z]{3}$/, {
    message:
      'currency deve ser um código ISO 4217 de 3 letras maiúsculas (ex.: BRL, USD).',
  })
  currency!: string;

  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;

  // Detalhamento livre do que está sendo negociado (2026-09-04) — o
  // que o usuário escreve hoje na descrição do cartão do Trello.
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  // Lista lateral de itens já na criação (2026-09-04) — o card de
  // cadastro é o mesmo card de detalhe, então a lista nasce junto.
  // Depois de criada, a lista muda por POST/DELETE em /:id/items.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(ITEM_NAME_MAX, { each: true })
  items?: string[];

  // status/lostReason não são setáveis na criação — toda Opportunity
  // nasce "open"; transição de status é uma ação explícita de update.
}
