import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RawLeadController } from './raw-lead.controller';
import { RawLeadService } from './raw-lead.service';

@Module({
  imports: [TenancyModule],
  controllers: [RawLeadController],
  providers: [RawLeadService],
  exports: [RawLeadService],
})
export class RawLeadModule {}
