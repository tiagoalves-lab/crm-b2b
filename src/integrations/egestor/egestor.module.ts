import { Module } from '@nestjs/common';
import { CompanyModule } from '../../companies/company.module';
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
import { EgestorWebhookController } from './egestor-webhook.controller';
import { EgestorWebhookEchoService } from './egestor-webhook-echo.service';
import { EgestorWebhookProcessingService } from './egestor-webhook-processing.service';
import { EgestorWebhookService } from './egestor-webhook.service';

@Module({
  imports: [TenancyModule, CompanyModule, PolicyModule],
  controllers: [EgestorSyncController, EgestorWebhookController],
  providers: [
    EgestorAuthService,
    EgestorCartaoCnpjService,
    EgestorHttpService,
    EgestorContatoSyncService,
    EgestorContatoPromoteService,
    EgestorContatoCorrectionService,
    EgestorInteractionLogService,
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
