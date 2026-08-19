import { IsIn, IsNotEmpty, IsString } from 'class-validator';

// Formato do payload que o eGestor envia (ver docs/webhook-egestor.md) —
// só chega porque cadastramos o webhook com `enviarComoJson: true`, então
// o corpo sempre é JSON (nunca form-data). `codigo` varia de tipo entre
// exemplos da doc (string) e o payload real observado no teste com
// webhook.site (number) — deixado sem `@IsString()`/`@IsNumber()`
// específico de propósito, `@IsNotEmpty()` cobre os dois.
export class EgestorWebhookPayloadDto {
  @IsIn(['created', 'updated', 'deleted'])
  action!: 'created' | 'updated' | 'deleted';

  @IsNotEmpty()
  codigo!: string | number;

  // Formato "yyyy-mm-dd HH:mm:ss" (não ISO — ver
  // EgestorWebhookService#parseDataEgestor).
  @IsString()
  date!: string;

  @IsIn(['produtos', 'contatos', 'vendas', 'usuarios', 'financeiro'])
  module!: string;

  @IsString()
  securityToken!: string;
}
