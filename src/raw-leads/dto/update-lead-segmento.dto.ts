import { IsString, MaxLength, ValidateIf } from 'class-validator';

// Segmento de negócio (pedido direto do usuário, 2026-08-05, fora do
// SPEC-CRM-GAMA.md original) — valor único por lead, texto livre. Mesmo
// contrato de UpdateLeadTierDto: campo obrigatório (não @IsOptional),
// `segmento: null` limpa o valor explicitamente — o cliente sempre
// declara a intenção, nunca "não mandei nada". @ValidateIf pula a
// validação de string só quando o valor é null (não quando é undefined,
// que continua rejeitado — força o cliente a mandar um dos dois).
export class UpdateLeadSegmentoDto {
  @ValidateIf((o: UpdateLeadSegmentoDto) => o.segmento !== null)
  @IsString()
  @MaxLength(60)
  segmento!: string | null;
}
