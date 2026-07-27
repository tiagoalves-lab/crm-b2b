import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';

@Module({
  imports: [TenancyModule],
  controllers: [MembershipController],
  providers: [MembershipService],
})
export class MembershipModule {}
