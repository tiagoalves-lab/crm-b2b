import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;
}
