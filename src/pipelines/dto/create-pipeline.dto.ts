import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePipelineDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  appliesTo?: string;
}
