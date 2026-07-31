import type { ActivityType } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ExactlyOneOf } from '../../common/validators/exactly-one-of.decorator';

// Tipos que fazem sentido pro usuário registrar manualmente — stage_change
// e field_update são gerados só pelo sistema (OpportunityService/etc.),
// nunca por este endpoint.
const MANUAL_ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'email'];

export class CreateActivityDto {
  // Relação polimórfica — mesmo padrão de Task/ListActivitiesQueryDto.
  @ExactlyOneOf(['companyId', 'opportunityId'])
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsIn(MANUAL_ACTIVITY_TYPES)
  type!: ActivityType;

  @IsString()
  @MaxLength(5000)
  texto!: string;

  // Subtipo livre (ex.: "reuniao", "visita", "posvenda") — guardado em
  // payload->>'subtipo', não no enum do banco (SPEC-CRM-GAMA.md §3.3,
  // "opção simples": cobre o vocabulário do protótipo sem migration).
  @IsOptional()
  @IsString()
  @MaxLength(50)
  subtipo?: string;
}
