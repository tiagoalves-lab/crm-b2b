import { ForbiddenException, Injectable } from '@nestjs/common';
import { CompanyService } from '../companies/company.service';
import { OpportunityService } from '../opportunities/opportunity.service';
import { RawLeadService } from '../raw-leads/raw-lead.service';
import { TaskService } from '../tasks/task.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

export interface SidebarCounts {
  leads: number;
  pipeline: number;
  tarefas: number;
  empresas: number;
}

// Contadores dos badges da barra lateral, numa chamada só.
//
// Por que existe (2026-08-13): o layout do frontend montava esses 4
// números baixando as 4 listagens INTEIRAS e contando em JS. Com 1.165
// empresas em produção e teto de 100 por página, só o contador de
// empresas custava 12 idas e voltas Vercel→Railway→Supabase — e isso
// rodava em TODA navegação do sistema, porque vive no layout. Era a maior
// fonte isolada de lentidão percebida no CRM.
//
// A implementação delega pro `findAll` de cada serviço em vez de montar
// os `where` de novo aqui. É de propósito: as regras de visibilidade são
// sutis e diferentes em cada recurso (empresa enxerga por CompanyAccess e
// por oportunidade vinculada, não só por dono; lead tem carteira por
// representante; tarefa filtra por responsável), e uma cópia dessas
// regras aqui sairia de sincronia com a listagem na primeira mudança —
// e o badge passaria a mostrar um número que a tela não confirma.
// `pageSize: 1` mantém o custo no COUNT: o findMany que acompanha traz
// uma linha só, que é descartada.
@Injectable()
export class CountsService {
  constructor(
    private readonly companies: CompanyService,
    private readonly opportunities: OpportunityService,
    private readonly tasks: TaskService,
    private readonly rawLeads: RawLeadService,
  ) {}

  async forSidebar(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<SidebarCounts> {
    const [leads, pipeline, tarefas, empresas] = await Promise.all([
      this.zeroIfForbidden(
        this.rawLeads
          .findAll(tx, membership, { status: 'novo', pageSize: 1 })
          .then((r) => r.total),
      ),
      this.zeroIfForbidden(
        this.opportunities
          .findAll(tx, membership, { status: 'open', pageSize: 1 })
          .then((r) => r.total),
      ),
      this.zeroIfForbidden(
        this.tasks
          .findAll(tx, membership, { status: 'pending', pageSize: 1 })
          .then((r) => r.total),
      ),
      // Empresas não precisa de filtro extra: o findAll já exclui as
      // deletadas e as que ainda estão em triagem (tag "lead-triagem"),
      // que é exatamente o critério do badge.
      this.zeroIfForbidden(
        this.companies
          .findAll(tx, membership, { pageSize: 1 })
          .then((r) => r.total),
      ),
    ]);

    return { leads, pipeline, tarefas, empresas };
  }

  // Um membro sem permissão num módulo não deve derrubar a barra lateral
  // inteira: o item nem aparece no menu pra ele, então o contador vira 0.
  // Só ForbiddenException é engolida — qualquer outro erro (banco fora,
  // bug) continua subindo, pra não mascarar falha de verdade como "0".
  private async zeroIfForbidden(promise: Promise<number>): Promise<number> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ForbiddenException) return 0;
      throw error;
    }
  }
}
