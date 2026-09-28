import type { TaskStatus, TaskType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ITEM_NAME_MAX, ITEMS_MAX } from '../../opportunities/opportunity-tags';
import { PARTICIPANTS_MAX, TASK_TYPES } from '../task-type.constants';

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

  // O prazo tem hora marcada? (2026-09-23) Sem isto o backend não
  // consegue distinguir "reunião à meia-noite" de "dia sem horário" — o
  // campo antigo sempre chegava como meia-noite UTC. Quem manda é a tela
  // que ofereceu o campo de hora.
  @IsOptional()
  @IsBoolean()
  dueHasTime?: boolean;

  @IsOptional()
  @IsIn(TASK_TYPES)
  tipo?: TaskType;

  // Obrigatório quando o tipo efetivo (este campo, ou o já salvo se
  // omitido aqui) é ligação/reunião/visita/e-mail — checado no service.
  @IsOptional()
  @IsUUID()
  contactId?: string;

  // Pessoas envolvidas na reunião (2026-09-24) — contatos da MESMA
  // empresa da tarefa que participam além do contato principal.
  // O service valida a empresa de cada um, tira repetidos e nunca deixa
  // o contato principal aparecer duas vezes. Substitui a lista
  // inteira; lista vazia limpa.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PARTICIPANTS_MAX)
  @IsUUID(undefined, { each: true })
  participantContactIds?: string[];

  @IsOptional()
  @IsIn(STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  // Mesma regra de CreateTaskDto.tags — substitui a lista inteira.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(ITEM_NAME_MAX, { each: true })
  tags?: string[];
}
