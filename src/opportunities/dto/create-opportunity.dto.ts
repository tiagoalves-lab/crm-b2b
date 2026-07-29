import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

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

  // status/lostReason não são setáveis na criação — toda Opportunity
  // nasce "open"; transição de status é uma ação explícita de update.
}
