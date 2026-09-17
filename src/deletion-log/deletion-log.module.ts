import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DeletionLogController } from './deletion-log.controller';

// Registro de exclusões (2026-09-16). A gravação é uma função simples
// (registrar-exclusao.ts) chamada dentro da transação de cada serviço que
// exclui; este módulo só expõe a leitura.
@Module({
  imports: [TenancyModule],
  controllers: [DeletionLogController],
})
export class DeletionLogModule {}
