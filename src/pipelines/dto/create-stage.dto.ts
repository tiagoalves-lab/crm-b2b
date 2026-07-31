import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStageDto {
  // 2-60 chars, não vazio — sem isso já nasceu no banco uma stage chamada
  // "Tiago Alves" (nome de pessoa, dado sujo de teste), ver
  // SPEC-CRM-GAMA.md §5.
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(60)
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
