import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { MembershipModule } from '../memberships/membership.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ReportConfigService } from './report-config.service';
import { ReportController } from './report.controller';
import { ReportSchedulerService } from './report-scheduler.service';
import { ReportService } from './report.service';

// Reports recorrentes por e-mail (2026-09-15). Hoje só o resumo diário do
// Pipeline; ver README pra receita de acrescentar outro tipo.
@Module({
  imports: [PrismaModule, TenancyModule, MembershipModule, MailModule],
  controllers: [ReportController],
  providers: [ReportService, ReportSchedulerService, ReportConfigService],
  // Exportados para o aviso de lead novo do Meta (NotificationModule):
  // "quem é elegível" e "quem escolheram na tela" são a MESMA regra dos
  // reports — duplicar isso lá seria o caminho curto para as duas listas
  // divergirem na primeira mudança.
  exports: [ReportService, ReportConfigService],
})
export class ReportModule {}
