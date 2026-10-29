import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CallService } from './call.service';
import { GravacaoService } from './gravacao.service';
import { TelefoniaAgenteController } from './telefonia-agente.controller';
import { TelefoniaController } from './telefonia.controller';
import { TelefoniaGravacaoController } from './telefonia-gravacao.controller';
import { TelefoniaDeviceService } from './telefonia-device.service';
import { TranscricaoService } from './transcricao.service';

@Module({
  imports: [
    TenancyModule,
    PolicyModule,
    ActivityModule,
    PrismaModule,
    StorageModule,
  ],
  controllers: [
    TelefoniaController,
    TelefoniaAgenteController,
    TelefoniaGravacaoController,
  ],
  providers: [
    CallService,
    TelefoniaDeviceService,
    GravacaoService,
    TranscricaoService,
  ],
  exports: [CallService],
})
export class TelefoniaModule {}
