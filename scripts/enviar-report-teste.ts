// Script ad-hoc: dispara o resumo diário do Pipeline pra UM endereço, pra
// conferir remetente, "responder para" e layout antes de ligar o envio
// automático (2026-09-15).
//
// Não registra nada em `report_log` (usa ReportSchedulerService#enviarTeste)
// — então não gasta o envio do dia nem engana a conferência das 9h.
//
// Rodar com as variáveis do Railway injetadas, pra usar a chave de envio
// de produção sem copiá-la pra lugar nenhum:
//
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/enviar-report-teste.ts alguem@dominio
//
// Sem o `railway run`, usa o .env local (que normalmente não tem
// RESEND_API_KEY) e o script avisa em vez de tentar enviar.

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReportSchedulerService } from '../src/reports/report-scheduler.service';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // `--valendo` faz o envio DE VERDADE: a lista real de destinatários, com
  // registro em `report_log` e a trava de um por dia — exatamente o que o
  // agendador faz às 8h. Usado pra antecipar o disparo do dia.
  const valendo = args.includes('--valendo');
  // `--followup` troca o resumo diário pelo report de follow-up das
  // cotações (as três etapas de proposta, 4x por dia útil).
  const followup = args.includes('--followup');
  const destinatario = args.find((a) => a.includes('@'));

  if (!valendo && !destinatario) {
    console.error(
      'Uso: ts-node scripts/enviar-report-teste.ts alguem@dominio   (teste)\n' +
        '     ts-node scripts/enviar-report-teste.ts --valendo       (envio real do dia)',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const scheduler = app.get(ReportSchedulerService);
    const resultado = valendo
      ? followup
        ? await scheduler.enviarFollowup()
        : await scheduler.enviarDiario()
      : followup
        ? await scheduler.enviarFollowupTeste(destinatario as string)
        : await scheduler.enviarTeste(destinatario as string);

    if (resultado.status === 'ja-enviado') {
      console.log(
        `O resumo de hoje já tinha saído para ${resultado.destinatarios} destinatário(s) — nada reenviado.`,
      );
      return;
    }

    if (resultado.status === 'desligado') {
      console.error(
        'Envio desligado: RESEND_API_KEY/MAIL_FROM não estão neste ambiente.',
      );
      process.exitCode = 1;
      return;
    }
    if (resultado.status === 'falha') {
      console.error(`Falhou: ${resultado.erro}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      valendo
        ? `Resumo do dia enviado para ${resultado.destinatarios} destinatário(s) (id ${resultado.messageId}).`
        : `Enviado para ${destinatario} (id ${resultado.messageId}).`,
    );
  } finally {
    await app.close();
  }
}

void main();
