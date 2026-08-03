import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SalesHistoryController } from './sales-history.controller';
import { SalesHistoryService } from './sales-history.service';

@Module({
  imports: [TenancyModule],
  controllers: [SalesHistoryController],
  providers: [SalesHistoryService],
})
export class SalesHistoryModule {}
