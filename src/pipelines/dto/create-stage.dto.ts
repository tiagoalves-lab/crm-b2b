import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateStageDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  probability!: number;

  @IsOptional()
  @IsBoolean()
  isWon?: boolean;

  @IsOptional()
  @IsBoolean()
  isLost?: boolean;
}
