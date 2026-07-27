import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ExactlyOneOf } from '../../common/validators/exactly-one-of.decorator';

// Mesmo padrão do Task: relação polimórfica, exatamente um dos três.
export class ListActivitiesQueryDto {
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
}
