import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CartaoCnpjService } from './cartao-cnpj.service';
import { CompanyAbcService } from './company-abc.service';
import { CompanyTeamService } from './company-team.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { ContactBulkController, ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule],
  controllers: [CompanyController, ContactController, ContactBulkController],
  providers: [
    CompanyService,
    ContactService,
    CompanyAbcService,
    CompanyTeamService,
    CartaoCnpjService,
  ],
  exports: [CompanyService, ContactService, CartaoCnpjService],
})
export class CompanyModule {}
