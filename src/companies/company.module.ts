import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
