import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RESULTADOS_MANUAIS } from '../telefonia.constants';

// Anotação da chamada (o que o SDR escreveu durante/depois da conversa) e,
// quando o script não está instalado na máquina, o encerramento manual com
// o resultado escolhido na tela.
export class AtualizarChamadaDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  observacao?: string;

  @IsOptional()
  @IsIn(RESULTADOS_MANUAIS)
  resultado?: (typeof RESULTADOS_MANUAIS)[number];
}
