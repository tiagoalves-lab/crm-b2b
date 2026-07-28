import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ExactlyOneOf } from '../../common/validators/exactly-one-of.decorator';

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

  // Coluna do Kanban — se não informada, cai na primeira coluna do
  // workspace (bootstrap preguiçoso via TaskListService se ainda não
  // existir nenhuma).
  @IsOptional()
  @IsUUID()
  listId?: string;

  // Default (não informado): quem está criando. Se informado, precisa ser
  // Membership ativo do mesmo workspace (checado no service).
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  // Relação polimórfica — exatamente um dos três, garantido tanto aqui
  // (400 limpo) quanto por CHECK constraint no Postgres (backstop). O
  // decorator é aplicado num campo só, mas valida o objeto inteiro.
  @ExactlyOneOf(['companyId', 'contactId', 'opportunityId'])
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;
}
