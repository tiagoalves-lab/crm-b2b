import { IsBoolean, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreateTaskListDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsOptional()
  @IsBoolean()
  isDoneList?: boolean;
}
