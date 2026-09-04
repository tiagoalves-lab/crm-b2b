import { Module } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { GlobalSearchService } from './global-search.service';

@Module({
  imports: [TenancyModule, PolicyModule],
  controllers: [SearchController],
  providers: [SearchService, GlobalSearchService],
})
export class SearchModule {}
