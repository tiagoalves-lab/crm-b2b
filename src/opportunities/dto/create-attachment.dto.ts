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
// Supabase Storage. Mirror de src/tasks/dto/create-attachment.dto.ts.
export class CreateAttachmentDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  // Mesmo limite do bucket (25MB, task-attachments).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26_214_400)
  sizeBytes?: number;
}
