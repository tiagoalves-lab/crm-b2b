import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Registro da INTENÇÃO de ligar, feito no clique do botão "Ligar" — antes
// de o MicroSIP sequer abrir. É o que permite casar o evento que volta da
// máquina do SDR (que só conhece o número) com a empresa/contato certos,
// em vez de adivinhar por telefone depois.
export class IniciarChamadaDto {
  @IsString()
  @MaxLength(40)
  telefone!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  rawLeadId?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;
}
