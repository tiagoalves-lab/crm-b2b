import { Module } from '@nestjs/common';
import { CompanyModule } from '../../companies/company.module';
import { MembershipModule } from '../../memberships/membership.module';
import { PolicyModule } from '../../policy/policy.module';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { EgestorAuthService } from './egestor-auth.service';
import { EgestorCartaoCnpjService } from './egestor-cartao-cnpj.service';
import { EgestorContatoCorrectionService } from './egestor-contato-correction.service';
import { EgestorContatoPromoteService } from './egestor-contato-promote.service';
import { EgestorContatoSyncService } from './egestor-contato-sync.service';
import { EgestorHttpService } from './egestor-http.service';
import { EgestorInteractionLogService } from './egestor-interaction-log.service';
import { EgestorSyncController } from './egestor-sync.controller';
import { EgestorUsuarioService } from './egestor-usuario.service';
import { EgestorVendaSyncService } from './egestor-venda-sync.service';
import { EgestorWebhookController } from './egestor-webhook.controller';
import { EgestorWebhookEchoService } from './egestor-webhook-echo.service';
import { EgestorWebhookProcessingService } from './egestor-webhook-processing.service';
import { EgestorWebhookService } from './egestor-webhook.service';

@Module({
  imports: [TenancyModule, CompanyModule, PolicyModule, MembershipModule],
  controllers: [EgestorSyncController, EgestorWebhookController],
  providers: [
    EgestorAuthService,
    EgestorCartaoCnpjService,
    EgestorHttpService,
    EgestorContatoSyncService,
    EgestorContatoPromoteService,
    EgestorContatoCorrectionService,
    EgestorInteractionLogService,
    EgestorUsuarioService,
    EgestorVendaSyncService,
    EgestorWebhookEchoService,
    EgestorWebhookProcessingService,
    EgestorWebhookService,
  ],
  exports: [
    EgestorCartaoCnpjService,
    EgestorContatoSyncService,
    EgestorContatoPromoteService,
    EgestorContatoCorrectionService,
  ],
})
export class EgestorModule {}
