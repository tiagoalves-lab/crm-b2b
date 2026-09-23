import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import { assertActiveMembership } from '../common/assert-active-membership';
import { PolicyService } from '../policy/policy.service';
import { ROLES_COM_ACESSO_AUTOMATICO } from './equipe-de-vendas';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// "Equipe de vendas" da empresa (pedido direto do usuário, 2026-09-21):
// aba nova na ficha do lead (Prospecção) pra escolher quem trabalha
// aquela empresa. Não é um conceito novo no banco — é a leitura/escrita
// explícita de CompanyAccess, que existe desde 2026-08-06 mas só era
// preenchido AUTOMATICAMENTE pelo dedupe de CNPJ (dois representantes
// cadastrando o mesmo CNPJ), sem nenhuma tela.
//
// Semântica de acesso (mesma de CompanyAccess desde a decisão original,
// não ampliada aqui): compartilha o PERFIL da empresa e o lead em
// Prospecção. Histórico, tarefas, contatos e oportunidades continuam
// privados de quem os criou.
export interface CompanyTeam {
  companyId: string;
  // Dono do registro — visibilidade garantida por ownerUserId, não por
  // CompanyAccess. Nunca aparece em `userIds` e não dá pra remover por
  // aqui (seria "empresa sem responsável", outra decisão).
  ownerUserId: string | null;
  // userIds com CompanyAccess explícito (o que esta aba edita).
  userIds: string[];
  // Quem pode mexer na lista — ver MANAGE_ROLES.
  podeEditar: boolean;
}

// Decidir quem enxerga o quê é meta-permissão (o mesmo raciocínio que
// mantém editar/excluir membro fixo em owner/admin no MembershipService,
// ver comentário em policy/permission-catalog.ts): não vira checkbox da
// matriz granular, senão um representante poderia se dar acesso ao que
// quisesse. Gerente entra porque a lista é justamente como ele distribui
// a carteira do time dele.
const MANAGE_ROLES: readonly MembershipRole[] = ['owner', 'admin', 'manager'];

@Injectable()
export class CompanyTeamService {
  constructor(private readonly policy: PolicyService) {}

  async find(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
  ): Promise<CompanyTeam> {
    const company = await this.mustBeVisible(tx, membership, companyId);
    const [grants, automaticos] = await Promise.all([
      tx.companyAccess.findMany({
        where: { companyId, workspaceId: membership.workspaceId },
        select: { userId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.userIdsComAcessoAutomatico(tx, membership.workspaceId),
    ]);
    return {
      companyId,
      ownerUserId: company.ownerUserId,
      userIds: grants
        .map((g) => g.userId)
        .filter(
          (userId) =>
            userId !== company.ownerUserId && !automaticos.has(userId),
        ),
      podeEditar: MANAGE_ROLES.includes(membership.role),
    };
  }

  // Substitui a lista inteira (PUT, não POST/DELETE por item): a aba
  // manda o estado final da equipe, então duas abas abertas ao mesmo
  // tempo não conseguem produzir um meio-termo esquisito — a última a
  // salvar vence, inteira.
  async set(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
    userIds: string[],
  ): Promise<CompanyTeam> {
    if (!MANAGE_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Só gerente, administrador ou dono pode mudar a equipe de vendas.',
      );
    }
    const company = await this.mustBeVisible(tx, membership, companyId);
    const automaticos = await this.userIdsComAcessoAutomatico(
      tx,
      membership.workspaceId,
    );

    // Responsável e quem tem acesso automático (admin/dono) nunca entram
    // na lista — se vierem marcados, é ruído do cliente, não erro.
    const desejados = [...new Set(userIds)].filter(
      (userId) => userId !== company.ownerUserId && !automaticos.has(userId),
    );
    // A equipe nunca fica vazia (regra do usuário, 2026-09-21): tem que
    // sobrar pelo menos um membro responsável pela empresa. Com
    // responsável definido isso já é verdade por construção — a trava
    // vale pra empresa que ficou sem dono (as que vieram do eGestor).
    if (!company.ownerUserId && desejados.length === 0) {
      throw new BadRequestException(
        'A equipe de vendas precisa de pelo menos um membro.',
      );
    }
    for (const userId of desejados) {
      await assertActiveMembership(tx, membership.workspaceId, userId);
    }

    // Preservados no apagar: o que esta tela não mostra ela também não
    // apaga (linha antiga de admin/dono vinda do dedupe por CNPJ, e a do
    // próprio responsável).
    const preservados = [
      ...desejados,
      ...automaticos,
      ...(company.ownerUserId ? [company.ownerUserId] : []),
    ];
    await tx.companyAccess.deleteMany({
      where: {
        companyId,
        workspaceId: membership.workspaceId,
        // `notIn: []` casaria linha nenhuma no Prisma (vira NOT IN () e
        // some da query), então lista vazia = apagar tudo, explícito.
        ...(preservados.length > 0 ? { userId: { notIn: preservados } } : {}),
      },
    });
    for (const userId of desejados) {
      await tx.companyAccess.upsert({
        where: { companyId_userId: { companyId, userId } },
        create: { workspaceId: membership.workspaceId, companyId, userId },
        update: {},
      });
    }

    return this.find(tx, membership, companyId);
  }

  private async userIdsComAcessoAutomatico(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<Set<string>> {
    const membros = await tx.membership.findMany({
      where: { workspaceId, role: { in: [...ROLES_COM_ACESSO_AUTOMATICO] } },
      select: { userId: true },
    });
    return new Set(membros.map((m) => m.userId));
  }

  // 404 (não 403) pra quem não enxerga a empresa — docs/seguranca.md,
  // decisão 4.2, mesmo critério de CompanyService#mustBeVisible.
  private async mustBeVisible(
    tx: TenantTx,
    membership: MembershipContext,
    companyId: string,
  ): Promise<{ id: string; ownerUserId: string | null }> {
    const company = await tx.company.findFirst({
      where: { id: companyId, workspaceId: membership.workspaceId },
      select: { id: true, ownerUserId: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    if (!(await this.policy.canReadCompany(tx, membership, companyId))) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }
}
