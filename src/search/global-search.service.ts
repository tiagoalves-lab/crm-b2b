import { Injectable } from '@nestjs/common';
import type {
  LeadTier,
  OpportunityStatus,
  Prisma,
  RawLeadStatus,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// Busca geral (pedido do usuário, 2026-09-03, no modelo da "Busca geral"
// do eGestor): um termo só, respondido em seções — Empresas, Contatos,
// Prospecção, Pipeline e Tarefas — cada uma limitada a LIMITE_POR_SECAO
// resultados. Cada seção reaplica EXATAMENTE a visibilidade da tela
// correspondente (mesmos canModule/scopeFilter/companyReadFilter dos
// findAll de CompanyService, ContactService, RawLeadService,
// OpportunityService e TaskService), então a busca nunca mostra o que a
// tela esconderia; seção sem permissão de 'ver' simplesmente não vem.

const LIMITE_POR_SECAO = 25;

export interface EmpresaEncontrada {
  id: string;
  nome: string;
  razaoSocial: string | null;
  cpfCnpj: string | null;
  cidade: string | null;
  uf: string | null;
  curvaAbc: string | null;
}

export interface ContatoEncontrado {
  id: string;
  companyId: string;
  empresa: string;
  nome: string;
  cargo: string | null;
  email: string | null;
  telefone: string | null;
  decisor: boolean;
}

export interface LeadEncontrado {
  id: string;
  razaoSocial: string;
  cnpj: string | null;
  municipio: string | null;
  uf: string | null;
  status: RawLeadStatus;
  score: number;
  manualTier: LeadTier | null;
  segmento: string | null;
}

export interface OportunidadeEncontrada {
  id: string;
  companyId: string;
  empresa: string;
  etapa: string;
  amount: string;
  currency: string;
  status: OpportunityStatus;
  expectedCloseDate: Date | null;
}

export interface TarefaEncontrada {
  id: string;
  title: string;
  status: TaskStatus;
  tipo: TaskType | null;
  dueAt: Date | null;
  assigneeUserId: string;
  empresa: string | null;
}

export interface GlobalSearchResult {
  q: string;
  empresas?: EmpresaEncontrada[];
  contatos?: ContatoEncontrado[];
  prospeccao?: LeadEncontrado[];
  pipeline?: OportunidadeEncontrada[];
  tarefas?: TarefaEncontrada[];
}

type NomesEmpresa = {
  razaoSocial: string | null;
  fantasia: string | null;
  nomeParaContato: string | null;
};

// Mesma prioridade de companyDisplayName no frontend (fantasia > razão
// social > nome pra contato) — o nome já sai pronto daqui pra cada seção
// não repetir a regra.
function nomeDaEmpresa(company: NomesEmpresa | null | undefined): string {
  return (
    company?.fantasia?.trim() ||
    company?.razaoSocial?.trim() ||
    company?.nomeParaContato?.trim() ||
    'Empresa sem nome'
  );
}

const SELECT_NOMES = {
  razaoSocial: true,
  fantasia: true,
  nomeParaContato: true,
} as const;

@Injectable()
export class GlobalSearchService {
  constructor(private readonly policy: PolicyService) {}

  async search(
    tx: TenantTx,
    membership: MembershipContext,
    q: string | undefined,
  ): Promise<GlobalSearchResult> {
    const term = (q ?? '').trim();
    const result: GlobalSearchResult = { q: term };
    if (term.length < 2) {
      return result;
    }

    const workspaceId = membership.workspaceId;
    // ILIKE via Prisma: não diferencia maiúscula/minúscula. Acento
    // diferencia — a base vem da Receita em caixa alta sem acento, então
    // na prática não pesa.
    const like = { contains: term, mode: 'insensitive' as const };
    // CNPJ/telefone ficam gravados só com dígitos; quem cola
    // "12.345.678/0001-95" ou "(11) 3333-4444" precisa achar do mesmo jeito.
    const digits = term.replace(/\D/g, '');
    const porDigitos = digits.length >= 3 ? digits : null;

    // Critério "parece esta empresa", reusado onde a busca é pela empresa
    // vinculada (contato, oportunidade, tarefa).
    const nomeEmpresa: Prisma.CompanyWhereInput[] = [
      { razaoSocial: like },
      { fantasia: like },
      { nomeParaContato: like },
      { cidade: like },
      ...(porDigitos ? [{ cpfCnpj: { contains: porDigitos } }] : []),
    ];

    const scope = await this.policy.scopeFilter(tx, membership);

    if (this.policy.canModule(membership, 'empresas_cadastro', 'ver')) {
      // companyReadFilter pode trazer um OR próprio (sales_rep) — vai num
      // AND pra não colidir com o OR dos campos.
      const visibilidade = await this.policy.companyReadFilter(tx, membership);
      const empresas = await tx.company.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          NOT: { tags: { has: 'lead-triagem' } },
          AND: [visibilidade, { OR: nomeEmpresa }],
        },
        select: {
          id: true,
          ...SELECT_NOMES,
          cpfCnpj: true,
          cidade: true,
          uf: true,
          curvaAbc: true,
        },
        orderBy: { razaoSocial: 'asc' },
        take: LIMITE_POR_SECAO,
      });
      result.empresas = empresas.map((c) => ({
        id: c.id,
        nome: nomeDaEmpresa(c),
        razaoSocial: c.razaoSocial,
        cpfCnpj: c.cpfCnpj,
        cidade: c.cidade,
        uf: c.uf,
        curvaAbc: c.curvaAbc,
      }));
    }

    if (this.policy.canModule(membership, 'contatos', 'ver')) {
      const contatos = await tx.contact.findMany({
        where: {
          workspaceId,
          ...scope,
          company: { deletedAt: null },
          OR: [
            { nome: like },
            { cargo: like },
            { email: like },
            ...(porDigitos ? [{ telefone: { contains: porDigitos } }] : []),
          ],
        },
        select: {
          id: true,
          companyId: true,
          nome: true,
          cargo: true,
          email: true,
          telefone: true,
          decisor: true,
          company: { select: SELECT_NOMES },
        },
        orderBy: { nome: 'asc' },
        take: LIMITE_POR_SECAO,
      });
      result.contatos = contatos.map((c) => ({
        id: c.id,
        companyId: c.companyId,
        empresa: nomeDaEmpresa(c.company),
        nome: c.nome,
        cargo: c.cargo,
        email: c.email,
        telefone: c.telefone,
        decisor: c.decisor,
      }));
    }

    if (this.policy.canModule(membership, 'leads', 'ver')) {
      // Todos os status (novo/aprovado/descartado) — a tela de Prospecção
      // separa em abas, a busca mostra o status na linha.
      const leads = await tx.rawLead.findMany({
        where: {
          workspaceId,
          ...scope,
          OR: [
            { razaoSocial: like },
            { cnaePrincipal: like },
            { cnaeDescricao: like },
            { municipio: like },
            { segmento: like },
            ...(porDigitos ? [{ cnpj: { contains: porDigitos } }] : []),
          ],
        },
        select: {
          id: true,
          razaoSocial: true,
          cnpj: true,
          municipio: true,
          uf: true,
          status: true,
          score: true,
          manualTier: true,
          segmento: true,
        },
        orderBy: [{ status: 'asc' }, { score: 'desc' }],
        take: LIMITE_POR_SECAO,
      });
      result.prospeccao = leads;
    }

    if (this.policy.canModule(membership, 'oportunidades', 'ver')) {
      const oportunidades = await tx.opportunity.findMany({
        where: {
          workspaceId,
          ...scope,
          deletedAt: null,
          company: { OR: nomeEmpresa },
        },
        select: {
          id: true,
          companyId: true,
          amount: true,
          currency: true,
          status: true,
          expectedCloseDate: true,
          stage: { select: { name: true } },
          company: { select: SELECT_NOMES },
        },
        orderBy: { createdAt: 'desc' },
        take: LIMITE_POR_SECAO,
      });
      result.pipeline = oportunidades.map((o) => ({
        id: o.id,
        companyId: o.companyId,
        empresa: nomeDaEmpresa(o.company),
        etapa: o.stage.name,
        amount: o.amount.toString(),
        currency: o.currency,
        status: o.status,
        expectedCloseDate: o.expectedCloseDate,
      }));
    }

    if (this.policy.canModule(membership, 'tarefas', 'ver')) {
      // Task usa assigneeUserId como "dono" — mesmo remapeamento de
      // TaskService#resolveAssigneeFilter.
      const escopoResponsavel =
        scope.ownerUserId === undefined
          ? {}
          : { assigneeUserId: scope.ownerUserId };
      const tarefas = await tx.task.findMany({
        where: {
          workspaceId,
          ...escopoResponsavel,
          OR: [
            { title: like },
            { description: like },
            { company: { OR: nomeEmpresa } },
            { opportunity: { company: { OR: nomeEmpresa } } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          tipo: true,
          dueAt: true,
          assigneeUserId: true,
          company: { select: SELECT_NOMES },
          opportunity: { select: { company: { select: SELECT_NOMES } } },
        },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        take: LIMITE_POR_SECAO,
      });
      result.tarefas = tarefas.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        tipo: t.tipo,
        dueAt: t.dueAt,
        assigneeUserId: t.assigneeUserId,
        empresa: t.company
          ? nomeDaEmpresa(t.company)
          : t.opportunity
            ? nomeDaEmpresa(t.opportunity.company)
            : null,
      }));
    }

    return result;
  }
}
