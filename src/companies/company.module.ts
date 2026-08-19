import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { ContactBulkController, ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule],
  controllers: [CompanyController, ContactController, ContactBulkController],
  providers: [CompanyService, ContactService],
  exports: [CompanyService, ContactService],
})
export class CompanyModule {}
