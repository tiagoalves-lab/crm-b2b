import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Único ponto do backend que fala com o provedor de envio de e-mail.
// Exportado pra quem precisar disparar (hoje só ReportsModule).
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
