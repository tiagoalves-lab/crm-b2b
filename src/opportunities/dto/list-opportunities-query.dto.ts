import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { OpportunityStatus } from '@prisma/client';

const STATUSES: OpportunityStatus[] = ['open', 'won', 'lost'];

// Não estende ListQueryDto (teto de 100 por página) de propósito: a tela
// Pipeline baixa a lista inteira e separa abertas/ganhas/perdidas no
// cliente, então o teto baixo cortava silenciosamente as mais antigas —
// apareceu de verdade em 2026-09-18, quando o histórico de cotações
// (123 oportunidades encerradas de 2025) entrou e as encerradas do mês
// escolhido sumiram da tela. Mesmo raciocínio (e mesmo teto) de
// ListRawLeadsQueryDto. Herdar e redeclarar não resolveria: o
// class-validator soma as regras da classe pai, e o @Max(100) dela
// continuaria valendo.
export class ListOpportunitiesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  pageSize?: number = 20;

  // Query params chegam como string — Transform explícito pelo mesmo
  // motivo documentado em ListQueryDto (Boolean("false") === true).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDeleted?: boolean = false;

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
