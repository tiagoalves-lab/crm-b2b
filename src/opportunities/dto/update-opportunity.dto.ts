import { PartialType } from '@nestjs/mapped-types';
import type { OpportunityStatus } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateOpportunityDto } from './create-opportunity.dto';

const STATUSES: OpportunityStatus[] = ['open', 'won', 'lost'];

export class UpdateOpportunityDto extends PartialType(CreateOpportunityDto) {
  // Obrigatório — o cliente sempre ecoa a versão que leu por último. É
  // assim que a concorrência otimista é aplicada (ver OpportunityService).
  @IsInt()
  version!: number;

  @IsOptional()
  @IsIn(STATUSES)
  status?: OpportunityStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lostReason?: string;
}
