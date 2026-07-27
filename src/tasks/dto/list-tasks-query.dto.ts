import { Transform, Type } from 'class-transformer';
import type { TaskStatus } from '@prisma/client';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const STATUSES: TaskStatus[] = ['pending', 'done'];

// Não estende ListQueryDto — Task não tem deletedAt (sem soft delete,
// diferente de Company/Contact/Opportunity), então "includeDeleted" não
// faz sentido aqui.
export class ListTasksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  // due_at < now() AND status = pending — calculado, nunca persistido
  // (docs/arquitetura-dados.md).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
}
