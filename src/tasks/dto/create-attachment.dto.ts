import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Metadados do arquivo antes do upload — o binário nunca passa pelo
// NestJS, vai direto do Server Action (Next.js) pra signed URL do
// Supabase Storage (SPEC-CRM-GAMA.md §3.2/§4.3).
export class CreateAttachmentDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  // Mesmo limite do bucket (25MB, ver migration de criação do bucket).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26_214_400)
  sizeBytes?: number;
}
