import { Controller, Get, Query } from '@nestjs/common';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { AnotacoesQueryDto } from './dto/anotacoes-query.dto';
import { AnotacoesRelatorioService } from './anotacoes-relatorio.service';
import { ContatosQueryDto } from './dto/contatos-query.dto';
import { ContatosRelatorioService } from './contatos-relatorio.service';
import { SlaOportunidadesQueryDto } from './dto/sla-oportunidades-query.dto';
import { SlaOportunidadesRelatorioService } from './sla-oportunidades-relatorio.service';
import { TarefasConcluidasQueryDto } from './dto/tarefas-concluidas-query.dto';
import { TarefasConcluidasRelatorioService } from './tarefas-concluidas-relatorio.service';

// Relatórios da TELA (menu à esquerda, filtros, resultado embaixo — molde
// do eGestor, pedido do usuário em 2026-09-23). Não confundir com
// `ReportController` (/reports), que é a configuração dos e-mails
// automáticos e só owner/admin acessa: aqui é trabalho de venda, cada
// relatório checa a permissão do próprio assunto e o escopo do papel.
@Controller('relatorios')
export class RelatorioController {
  constructor(
    private readonly anotacoes: AnotacoesRelatorioService,
    private readonly tarefasConcluidas: TarefasConcluidasRelatorioService,
    private readonly contatos: ContatosRelatorioService,
    private readonly slaOportunidades: SlaOportunidadesRelatorioService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('anotacoes')
  gerarAnotacoes(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: AnotacoesQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.anotacoes.gerar(tx, membership, query),
    );
  }

  @Get('tarefas-concluidas')
  gerarTarefasConcluidas(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: TarefasConcluidasQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.tarefasConcluidas.gerar(tx, membership, query),
    );
  }

  @Get('contatos')
  gerarContatos(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ContatosQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.contatos.gerar(tx, membership, query),
    );
  }

  @Get('sla-oportunidades')
  gerarSlaOportunidades(
    @CurrentMembership() membership: MembershipContext,
    @Query() query: SlaOportunidadesQueryDto,
  ) {
    return this.tenantContext.run(
      {
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      },
      (tx) => this.slaOportunidades.gerar(tx, membership, query),
    );
  }
}
