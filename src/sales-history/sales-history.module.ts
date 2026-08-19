import { Module } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SalesHistoryController } from './sales-history.controller';
import { SalesHistoryService } from './sales-history.service';

@Module({
  imports: [TenancyModule, PolicyModule],
  controllers: [SalesHistoryController],
  providers: [SalesHistoryService],
})
export class SalesHistoryModule {}
