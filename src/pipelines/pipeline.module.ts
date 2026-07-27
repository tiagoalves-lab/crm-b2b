import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [TenancyModule],
  controllers: [PipelineController],
  providers: [PipelineService],
})
export class PipelineModule {}
