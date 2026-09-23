import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Eventos que o script instalado junto do MicroSIP manda (ver
// scripts/telefonia/). São os quatro ganchos que o MicroSIP oferece,
// traduzidos pro vocabulário do CRM:
//   'discando'  → cmdOutgoingCall  (opcional; só enriquece o registro)
//   'atendida'  → cmdCallStart     (conexão estabelecida = alguém atendeu)
//   'encerrada' → cmdCallEnd       (fim da chamada)
//   'recebida'  → cmdIncomingCall  (chamada de entrada tocando)
export const EVENTOS_CHAMADA = [
  'discando',
  'atendida',
  'encerrada',
  'recebida',
] as const;

export class EventoChamadaDto {
  @IsIn(EVENTOS_CHAMADA)
  evento!: (typeof EVENTOS_CHAMADA)[number];

  @IsString()
  @MaxLength(40)
  telefone!: string;

  // Momento do evento na máquina do SDR (ISO). Opcional: sem ele, vale a
  // hora em que o servidor recebeu — diferença de segundos, irrelevante
  // pro registro, mas melhor usar a da origem quando existe.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  em?: string;
}
