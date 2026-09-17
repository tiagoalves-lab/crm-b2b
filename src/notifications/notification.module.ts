import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { MembershipModule } from '../memberships/membership.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { NotificationService } from './notification.service';

// Avisos pontuais por e-mail (tarefa designada, membro destacado).
// Separado do ReportModule de propósito: reports são agendados e em lote,
// isto aqui é reação a uma ação de usuário.
@Module({
  imports: [TenancyModule, MembershipModule, MailModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
