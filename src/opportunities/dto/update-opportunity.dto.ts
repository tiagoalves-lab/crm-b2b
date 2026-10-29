import { PartialType } from '@nestjs/mapped-types';
import type { OpportunityStatus } from '@prisma/client';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SLA_TRATAMENTOS, type SlaTratamento } from '../opportunity-sla';
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

  // Tratamento do SLA ao voltar um card de Negociação para uma etapa de
  // proposta (2026-09-16) — obrigatório nesse movimento, ignorado nos
  // outros. Ver opportunity-sla.ts.
  @IsOptional()
  @IsIn(SLA_TRATAMENTOS)
  slaTratamento?: SlaTratamento;

  // Stand by (2026-10-22): true coloca a oportunidade em espera — exige
  // `expectedCloseDate` nova, de hoje em diante; false retoma a negociação.
  // Ver OpportunityService#proximoStandby.
  @IsOptional()
  @IsBoolean()
  standby?: boolean;
}
