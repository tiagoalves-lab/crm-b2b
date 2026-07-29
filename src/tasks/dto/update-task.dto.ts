import type { TaskStatus } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
  @IsIn(STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  // Mover entre colunas (drag-and-drop) — ver TaskService.update pra
  // sincronização automática com `status` quando a coluna de destino é
  // is_done_list.
  @IsOptional()
  @IsUUID()
  listId?: string;

  // Posição fracionária dentro da coluna (fractional indexing) — o
  // cliente calcula a média entre os vizinhos ao redor do drop; o backend
  // só armazena o valor, sem recalcular os outros cartões.
  @IsOptional()
  @IsNumber()
  position?: number;
}
