import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import type { OpportunityStatus } from '@prisma/client';
import { ListQueryDto } from '../../common/dto/list-query.dto';

const STATUSES: OpportunityStatus[] = ['open', 'won', 'lost'];

export class ListOpportunitiesQueryDto extends ListQueryDto {
  // Filtro de status no servidor (2026-08-13). Antes só existia filtro no
  // cliente: o frontend baixava TODAS as oportunidades e contava as "open"
  // em JS — o que obrigava a trazer a lista inteira só pra exibir o número
  // do badge da barra lateral. Com isto o contador vira um COUNT no banco
  // (ver src/counts/).
  @IsOptional()
  @IsIn(STATUSES)
  status?: OpportunityStatus;

  // Oportunidades "open" sem stage_change (ou criação, se nunca mudou de
  // stage) há pelo menos N dias — base do alerta "deal parado" da Fase 4
  // (docs/roadmap.md).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  staleDays?: number;

  // Ficha da empresa (SPEC-CRM-GAMA.md §4.1, aba "Oportunidades").
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
