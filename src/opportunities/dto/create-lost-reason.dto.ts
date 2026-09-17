import { IsString, MaxLength } from 'class-validator';
import { LOST_REASON_MAX } from '../opportunity-lost-reason.service';

// Motivo de perda novo, cadastrado pelo modal de "Marcar Perdida".
export class CreateLostReasonDto {
  @IsString()
  @MaxLength(LOST_REASON_MAX)
  nome!: string;
}
