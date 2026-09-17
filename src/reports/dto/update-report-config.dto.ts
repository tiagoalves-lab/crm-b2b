import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Corpo do PATCH da tela "E-mail automático". Allowlist estrita (o
// ValidationPipe global recusa campo não declarado) — mesmo padrão dos
// outros DTOs do projeto. A validação de conteúdo (formato de horário,
// quantidade, coerência entre ativo/horários/etapas) fica no
// ReportConfigService, que é quem conhece as regras de cada tipo.
export class UpdateReportConfigDto {
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(5, { each: true })
  horarios?: string[];

  @IsOptional()
  @IsBoolean()
  diasUteis?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  etapas?: string[];

  // user_id de quem recebe ESTE report. Lista vazia = todos os elegíveis.
  // Quem pode entrar é conferido no ReportConfigService (só membro ativo
  // que não é representante).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  destinatarios?: string[];
}
