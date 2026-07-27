import { Module } from '@nestjs/common';
import { ActivityModule } from '../activities/activity.module';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [TenancyModule, PolicyModule, ActivityModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
