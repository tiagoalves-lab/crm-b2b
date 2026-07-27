import type { TaskStatus } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const STATUSES: TaskStatus[] = ['pending', 'done'];

// Alvo polimórfico (company/contact/opportunity) é imutável após criação
// — de propósito não estende CreateTaskDto, pra não reabrir a checagem de
// "exatamente um" a cada edição.
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;
}
