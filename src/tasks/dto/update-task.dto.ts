import type { TaskStatus, TaskType } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TASK_TYPES } from '../task-type.constants';

const STATUSES: TaskStatus[] = ['pending', 'done'];

// Alvo polimórfico (company/opportunity) é imutável após criação
// — de propósito não estende CreateTaskDto, pra não reabrir a checagem de
// "exatamente um" a cada edição.
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsIn(TASK_TYPES)
  tipo?: TaskType;

  // Obrigatório quando o tipo efetivo (este campo, ou o já salvo se
  // omitido aqui) é ligação/reunião/visita/e-mail — checado no service.
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;
}
