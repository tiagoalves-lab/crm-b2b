import { EgestorContatoStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';

const STATUSES = Object.values(EgestorContatoStatus);

export class ListContatosQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: EgestorContatoStatus;
}
