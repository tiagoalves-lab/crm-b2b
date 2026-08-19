import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

// Tags livres da Prospecção (pedido direto do usuário, 2026-08-05, fora do
// SPEC-CRM-GAMA.md original) — o cliente sempre manda o conjunto completo
// desejado, mesmo padrão de UpdateLeadTierDto (não é "adicionar mais
// uma", é "o array agora é este"). Trim/dedupe acontece no service,
// aqui só valida forma. Limite de 20 tags/lead e 40 caracteres por tag —
// generoso pra rótulo curto, sem abrir espaço pra abuso.
export class UpdateLeadTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags!: string[];
}
