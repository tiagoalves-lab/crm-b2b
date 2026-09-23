import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CriarDispositivoDto {
  // Nome pra pessoa reconhecer a máquina depois ("Notebook do Arlei").
  @IsString()
  @MaxLength(120)
  nome!: string;

  // Só owner/admin pode gerar credencial pra outra pessoa; sem isso, é
  // sempre pra quem está pedindo (checado no service).
  @IsOptional()
  @IsUUID()
  userId?: string;
}
