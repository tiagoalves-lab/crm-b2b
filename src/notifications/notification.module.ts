import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { MembershipModule } from '../memberships/membership.module';
import { ReportModule } from '../reports/report.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { NotificationService } from './notification.service';

// Avisos pontuais por e-mail (tarefa designada, membro destacado, lead
// novo do Meta).
// Separado do ReportModule de propósito: reports são agendados e em lote,
// isto aqui é reação a uma ação de usuário.
@Module({
  imports: [TenancyModule, MembershipModule, MailModule, ReportModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
