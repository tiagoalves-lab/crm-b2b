import type { TaskType } from '@prisma/client';
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
import { ExactlyOneOf } from '../../common/validators/exactly-one-of.decorator';
import { ITEM_NAME_MAX, ITEMS_MAX } from '../../opportunities/opportunity-tags';
import { PARTICIPANTS_MAX, TASK_TYPES } from '../task-type.constants';

export class CreateTaskDto {
  @IsString()
  @MaxLength(255)
  title!: string;

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

  // Obrigatório quando tipo é ligação/reunião/visita/e-mail — checado no
  // service (junto com "pertence à mesma company da tarefa"), não aqui.
  @IsOptional()
  @IsUUID()
  contactId?: string;

  // Pessoas envolvidas na reunião (2026-09-24) — contatos da MESMA
  // empresa da tarefa que participam além do contato principal.
  // O service valida a empresa de cada um, tira repetidos e nunca deixa
  // o contato principal aparecer duas vezes.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PARTICIPANTS_MAX)
  @IsUUID(undefined, { each: true })
  participantContactIds?: string[];

  // Default (não informado): quem está criando. Se informado, precisa ser
  // Membership ativo do mesmo workspace (checado no service).
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  // Relação polimórfica — exatamente um dos dois, garantido tanto aqui
  // (400 limpo) quanto por CHECK constraint no Postgres (backstop). O
  // decorator é aplicado num campo só, mas valida o objeto inteiro.
  @ExactlyOneOf(['companyId', 'opportunityId'])
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  // Carimbo de itens da oportunidade de origem (2026-09-04) — só com
  // opportunityId, e cada tag precisa ser item da lista dela; checado no
  // service (opportunities/opportunity-tags.ts).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(ITEM_NAME_MAX, { each: true })
  tags?: string[];
}
