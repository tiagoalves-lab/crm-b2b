import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CallService } from './call.service';
import { TelefoniaAgenteController } from './telefonia-agente.controller';
import { TelefoniaController } from './telefonia.controller';
import { TelefoniaDeviceService } from './telefonia-device.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule, PrismaModule],
  controllers: [TelefoniaController, TelefoniaAgenteController],
  providers: [CallService, TelefoniaDeviceService],
  exports: [CallService],
})
export class TelefoniaModule {}
