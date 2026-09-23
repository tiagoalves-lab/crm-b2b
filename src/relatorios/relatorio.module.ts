import { Module } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AnotacoesRelatorioService } from './anotacoes-relatorio.service';
import { RelatorioController } from './relatorio.controller';
import { TarefasConcluidasRelatorioService } from './tarefas-concluidas-relatorio.service';

// Relatórios da tela Relatórios. Cada relatório novo entra aqui como um
// service próprio + uma rota em RelatorioController.
@Module({
  imports: [TenancyModule, PolicyModule],
  controllers: [RelatorioController],
  providers: [AnotacoesRelatorioService, TarefasConcluidasRelatorioService],
})
export class RelatorioModule {}
