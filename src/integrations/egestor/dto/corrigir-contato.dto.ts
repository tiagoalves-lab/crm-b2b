import { IsIn } from 'class-validator';
import type { CorrecaoDirecao } from '../egestor-contato-correction.service';

const DIRECOES: CorrecaoDirecao[] = [
  'matriz_para_filial',
  'filial_para_matriz',
];

export class CorrigirContatoDto {
  @IsIn(DIRECOES)
  direcao!: CorrecaoDirecao;
}
