import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Membership, MembershipRole } from '@prisma/client';
import {
  MODULE_ACTIONS,
  PERMISSION_MODULES,
  parsePermissionMatrix,
  type PermissionMatrix,
} from '../policy/permission-catalog';
import { PolicyService } from '../policy/policy.service';
import { MembershipCacheService } from '../tenancy/membership-cache.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CreateMembershipDto } from './dto/create-membership.dto';
import type { UpdateMembershipDto } from './dto/update-membership.dto';
import { SupabaseUserService } from './supabase-user.service';

// Mesmo critério do PipelineService: gestão de membros (editar papel,
// suspender, remover) é config de workspace, só owner/admin mexem. Isto é
// meta-permissão (quem pode dar acesso a quem) — de propósito NÃO vira
// checkbox da matriz (ver comentário de MODULE_ACTIONS.membros em
// permission-catalog.ts): abrir isso seria caminho de escalonamento de
// privilégio.
const WRITE_ROLES = new Set(['owner', 'admin']);

// Pedido direto do usuário (2026-08-06): "o responsável" (gerente) também
// pode CADASTRAR membros — não editar/remover, só criar, e só com um dos
// dois papéis abaixo (admin/owner continuam exclusivos de quem já é
// admin/owner, via WRITE_ROLES acima — um gerente não pode se auto-promover
// nem promover outro membro criando-o direto como admin). A partir de
// 2026-08-12, ELEGIBILIDADE continua travada em "role === 'manager'" (só
// quem já é gerente pode sequer tentar), mas fica sujeita também ao
// checkbox "membros.criar" da matriz — um owner/admin pode desligar isso
// pra um gerente específico sem rebaixar o papel dele.
const MANAGER_CREATABLE_ROLES = new Set<MembershipRole>([
  'manager',
  'sales_rep',
]);

@Injectable()
export class MembershipService {
  constructor(
    private readonly supabaseUser: SupabaseUserService,
    private readonly policy: PolicyService,
    // Opcional só pelo membership.service.spec.ts, que instancia com dois
    // argumentos. Em produção sempre vem (TenancyModule exporta).
    @Optional() private readonly membershipCache?: MembershipCacheService,
  ) {}

  // Cria o login (Supabase Auth) e o Membership do workspace atual numa
  // única chamada — não existe fluxo de convite por e-mail (adiado no
  // roadmap), então o admin já entra com e-mail/senha prontos.
  async create(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CreateMembershipDto,
  ): Promise<Membership> {
    const isFullManager = WRITE_ROLES.has(membership.role);
    const isTeamManager =
      membership.role === 'manager' &&
      this.policy.canModule(membership, 'membros', 'criar');
    if (!isFullManager && !isTeamManager) {
      throw new ForbiddenException(
        'Só owner/admin/gerente podem cadastrar membros.',
      );
    }

    const role: MembershipRole = dto.role ?? 'sales_rep';
    // Gerente só cadastra Gerente/Representante (admin/owner continuam
    // exclusivos de quem já é owner/admin) — checado antes de qualquer
    // outra coisa, mesmo padrão de "nega cedo" já usado no resto do
    // service (ver update()/remove() abaixo).
    if (isTeamManager && !MANAGER_CREATABLE_ROLES.has(role)) {
      throw new ForbiddenException(
        'Gerente só pode cadastrar membros com papel Gerente ou Representante.',
      );
    }

    // dto.permissions vem da subpágina de Permissões do modal de membro
    // (web/app/dashboard/membros) — sempre validado contra o catálogo
    // (parsePermissionMatrix rejeita módulo/ação desconhecida) e depois
    // capado contra o que O PRÓPRIO ATOR pode (capPermissionsToActor):
    // um gerente nunca consegue, por esta tela, conceder a um subordinado
    // uma permissão que ele mesmo não tem — fecha o caminho óbvio de
    // escalonamento de privilégio de uma matriz editável por não-admin.
    const permissions = dto.permissions
      ? this.capPermissionsToActor(
          membership,
          parsePermissionMatrix(dto.permissions),
        )
      : undefined;

    // Gerente não escolhe o managerId do novo membro — sempre o próprio
    // gerente que está cadastrando, pra não abrir brecha de alocar alguém
    // no time de outro gerente por essa tela. owner/admin continuam livres
    // pra escolher (ou deixar sem gerente), como sempre.
    const managerId = isTeamManager ? membership.id : dto.managerId;

    if (managerId) {
      const manager = await tx.membership.findFirst({
        where: {
          id: managerId,
          workspaceId: membership.workspaceId,
          status: 'active',
        },
      });
      if (!manager) {
        throw new BadRequestException(
          'Gerente informado não é um membro ativo deste workspace.',
        );
      }
    }

    const { id: userId } = await this.supabaseUser.createUser(
      dto.login,
      dto.password,
      dto.name,
      dto.email,
    );

    return tx.membership.create({
      data: {
        workspaceId: membership.workspaceId,
        userId,
        role,
        managerId,
        status: 'active',
        joinedAt: new Date(),
        permissions: permissions,
      },
    });
  }

  findAll(tx: TenantTx, membership: MembershipContext): Promise<Membership[]> {
    // Leitura aberta a qualquer Membership ativo — todo mundo precisa ver
    // quem é seu gerente/subordinado, não só admin.
    return tx.membership.findMany({
      where: { workspaceId: membership.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
    dto: UpdateMembershipDto,
  ): Promise<Membership> {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new ForbiddenException('Só owner/admin podem gerenciar membros.');
    }

    const existing = await tx.membership.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!existing) {
      throw new NotFoundException('Membro não encontrado.');
    }

    if (dto.managerId) {
      if (dto.managerId === id) {
        throw new BadRequestException(
          'Um membro não pode ser gerente de si mesmo.',
        );
      }
      const manager = await tx.membership.findFirst({
        where: {
          id: dto.managerId,
          workspaceId: membership.workspaceId,
          status: 'active',
        },
      });
      if (!manager) {
        throw new BadRequestException(
          'Gerente informado não é um membro ativo deste workspace.',
        );
      }
    }

    const losingOwnership =
      existing.role === 'owner' &&
      existing.status !== 'suspended' &&
      ((dto.role !== undefined && dto.role !== 'owner') ||
        dto.status === 'suspended');
    if (losingOwnership) {
      const activeOwners = await tx.membership.count({
        where: {
          workspaceId: membership.workspaceId,
          role: 'owner',
          status: 'active',
        },
      });
      if (activeOwners <= 1) {
        throw new BadRequestException(
          'Não é possível rebaixar/suspender o último owner ativo do workspace.',
        );
      }
    }

    // update() já é owner/admin-only (checagem no topo) — capPermissionsToActor
    // é no-op nesse caso (canModule sempre true pra owner/admin), mas passa
    // pelo mesmo caminho de validação/cap de create() por consistência e
    // como defesa em profundidade caso este gate mude no futuro.
    const permissions = dto.permissions
      ? this.capPermissionsToActor(
          membership,
          parsePermissionMatrix(dto.permissions),
        )
      : undefined;

    const updated = await tx.membership.update({
      where: { id: existing.id },
      data: {
        role: dto.role,
        status: dto.status,
        managerId: dto.managerId,
        permissions: permissions,
      },
    });
    // Papel/status/permissões novos valem na próxima requisição do membro
    // (o guard relê do banco). A invalidação acontece antes do COMMIT do
    // controller — a janela em que outra requisição do mesmo usuário
    // poderia recachear a linha antiga é de milissegundos, e o TTL do
    // cache cobre o resto.
    this.membershipCache?.invalidate(existing.userId);
    return updated;
  }

  // Um ator não-owner/admin (ex.: gerente cadastrando um subordinado) nunca
  // consegue, por esta tela, conceder uma permissão que ele mesmo não tem —
  // pra cada módulo×ação marcado true na matriz recebida, se o PRÓPRIO
  // ator não passa em canModule() pra aquele módulo×ação, força false em
  // vez de aceitar. owner/admin: canModule sempre true, então isto nunca
  // reduz nada pra eles (na prática só se aplica no create() de um
  // gerente — update() é owner/admin-only, ver acima).
  private capPermissionsToActor(
    actor: MembershipContext,
    matrix: PermissionMatrix,
  ): PermissionMatrix {
    const capped: PermissionMatrix = {};
    for (const module of PERMISSION_MODULES) {
      const requested = matrix[module];
      if (!requested) continue;
      const cappedActions: PermissionMatrix[typeof module] = {};
      for (const action of MODULE_ACTIONS[module]) {
        const value = requested[action];
        if (value === undefined) continue;
        cappedActions[action] =
          value && !this.policy.canModule(actor, module, action)
            ? false
            : value;
      }
      capped[module] = cappedActions;
    }
    return capped;
  }

  async remove(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<Membership> {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new ForbiddenException('Só owner/admin podem gerenciar membros.');
    }

    const existing = await tx.membership.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    if (!existing) {
      throw new NotFoundException('Membro não encontrado.');
    }

    if (existing.role === 'owner' && existing.status === 'active') {
      const activeOwners = await tx.membership.count({
        where: {
          workspaceId: membership.workspaceId,
          role: 'owner',
          status: 'active',
        },
      });
      if (activeOwners <= 1) {
        throw new BadRequestException(
          'Não é possível remover o último owner ativo do workspace.',
        );
      }
    }

    // manager_id tem ON DELETE SET NULL (ver migration) — quem reportava
    // pra esse membro fica sem gerente automaticamente, sem violar FK.
    const removed = await tx.membership.delete({ where: { id: existing.id } });
    this.membershipCache?.invalidate(existing.userId);
    return removed;
  }
}
