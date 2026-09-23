import { BadRequestException } from '@nestjs/common';

// Dia civil de Brasília → instante. O backend roda em UTC (Railway): sem
// fixar o deslocamento, "01/09 a 30/09" pegaria das 21h do dia 31/08 às
// 21h do dia 30/09. O Brasil não tem mais horário de verão desde 2019,
// então -03:00 é constante (mesma premissa de reports/report-datas.ts).
export function periodoBrasilia(
  inicio: string,
  fim: string,
): { de: Date; ate: Date } {
  const de = new Date(`${inicio}T00:00:00.000-03:00`);
  const ate = new Date(`${fim}T23:59:59.999-03:00`);
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) {
    throw new BadRequestException('Período inválido.');
  }
  if (de > ate) {
    throw new BadRequestException(
      'A data inicial precisa ser anterior à data final.',
    );
  }
  return { de, ate };
}
