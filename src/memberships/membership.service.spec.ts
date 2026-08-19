import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Membership } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { MembershipService } from './membership.service';
import type { SupabaseUserService } from './supabase-user.service';

const WORKSPACE_ID = 'workspace-1';

function callerMembership(
  overrides: Partial<MembershipContext> = {},
): MembershipContext {
  return {
    id: 'membership-owner',
    workspaceId: WORKSPACE_ID,
    userId: 'user-owner',
    role: 'owner',
    status: 'active',
    permissions: null,
    ...overrides,
  };
}

function targetRow(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'membership-target',
    workspaceId: WORKSPACE_ID,
    userId: 'user-target',
    role: 'owner',
    status: 'active',
    managerId: null,
    invitedBy: null,
    joinedAt: new Date(),
    createdAt: new Date(),
    permissions: null,
    ...overrides,
  };
}

function fakeTx(
  options: { target?: Membership; activeOwnerCount?: number } = {},
): TenantTx {
  const target = options.target ?? targetRow();
  return {
    membership: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) => {
          if (where.id === target.id) return Promise.resolve(target);
          return Promise.resolve(null);
        }),
      count: jest.fn().mockResolvedValue(options.activeOwnerCount ?? 1),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ id: 'membership-new', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...target, ...data }),
        ),
      delete: jest.fn().mockResolvedValue(target),
    },
  } as unknown as TenantTx;
}

function fakeSupabaseUser(): SupabaseUserService {
  return {
    createUser: jest.fn().mockResolvedValue({ id: 'auth-user-1' }),
  } as unknown as SupabaseUserService;
}

describe('MembershipService', () => {
  let service: MembershipService;
  let supabaseUser: SupabaseUserService;

  beforeEach(() => {
    supabaseUser = fakeSupabaseUser();
    // PolicyService de verdade (não mock) — é lógica pura síncrona
    // (canModule), sem I/O, mais simples testar contra o real do que
    // stubar caso a caso.
    service = new MembershipService(supabaseUser, new PolicyService());
  });

  describe('create', () => {
    it('rejeita quem não é owner/admin/gerente', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, callerMembership({ role: 'sales_rep' }), {
          name: 'Novo Membro',
          login: 'novo.membro',
          password: 'senha1234',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(supabaseUser.createUser).not.toHaveBeenCalled();
    });

    // Gerente cadastrando membros — pedido direto do usuário, 2026-08-06
    // ("o responsável pode inserir outros membros"), restrito a
    // gerente/representante (owner/admin continuam exclusivos).
    it('gerente pode cadastrar sales_rep, forçando managerId pro próprio gerente (ignora managerId enviado)', async () => {
      // O lookup de "managerId é membro ativo" busca o PRÓPRIO gerente
      // (é pra ele mesmo que o managerId é forçado) — fixture precisa
      // resolver esse id como ativo.
      const caller = targetRow({ id: 'membership-gerente', role: 'manager' });
      const tx = fakeTx({ target: caller });
      await service.create(
        tx,
        callerMembership({ id: caller.id, role: 'manager' }),
        {
          name: 'Novo Rep',
          login: 'novo.rep',
          password: 'senha1234',
          role: 'sales_rep',
          managerId: 'membership-outro-gerente', // ignorado — ver assert abaixo
        },
      );
      expect(
        (tx.membership.create as jest.Mock).mock.calls[0][0].data,
      ).toMatchObject({
        role: 'sales_rep',
        managerId: 'membership-gerente',
      });
    });

    it('gerente pode cadastrar outro gerente (manager)', async () => {
      const caller = targetRow({ id: 'membership-gerente', role: 'manager' });
      const tx = fakeTx({ target: caller });
      await service.create(
        tx,
        callerMembership({ id: caller.id, role: 'manager' }),
        {
          name: 'Outro Gerente',
          login: 'outro.gerente',
          password: 'senha1234',
          role: 'manager',
        },
      );
      expect(
        (tx.membership.create as jest.Mock).mock.calls[0][0].data,
      ).toMatchObject({
        role: 'manager',
        managerId: 'membership-gerente',
      });
    });

    it('gerente não pode cadastrar admin/owner', async () => {
      const tx = fakeTx();
      await expect(
        service.create(
          tx,
          callerMembership({ id: 'membership-gerente', role: 'manager' }),
          {
            name: 'Tentativa Admin',
            login: 'tentativa.admin',
            password: 'senha1234',
            role: 'admin',
          },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(supabaseUser.createUser).not.toHaveBeenCalled();
    });

    it('rejeita managerId que não é membro ativo do workspace', async () => {
      const tx = fakeTx();
      await expect(
        service.create(tx, callerMembership(), {
          name: 'Novo Membro',
          login: 'novo.membro',
          password: 'senha1234',
          managerId: 'membership-inexistente',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(supabaseUser.createUser).not.toHaveBeenCalled();
    });

    it('cria o login no Supabase Auth e o Membership com role default sales_rep', async () => {
      const tx = fakeTx();
      const created = await service.create(tx, callerMembership(), {
        name: 'Novo Membro',
        login: 'novo.membro',
        password: 'senha1234',
      });
      expect(supabaseUser.createUser).toHaveBeenCalledWith(
        'novo.membro',
        'senha1234',
        'Novo Membro',
        undefined,
      );
      expect(
        (tx.membership.create as jest.Mock).mock.calls[0][0].data,
      ).toMatchObject({
        workspaceId: WORKSPACE_ID,
        userId: 'auth-user-1',
        role: 'sales_rep',
        status: 'active',
      });
      expect(created.userId).toBe('auth-user-1');
    });

    // E-mail de contato (2026-08-06) — separado do login, repassado direto
    // pro Supabase Auth via createUser (ver SupabaseUserService).
    it('repassa o e-mail de contato pro Supabase Auth quando informado', async () => {
      const tx = fakeTx();
      await service.create(tx, callerMembership(), {
        name: 'Novo Membro',
        login: 'novo.membro',
        password: 'senha1234',
        email: 'novo.membro@gamabrasil.com.br',
      });
      expect(supabaseUser.createUser).toHaveBeenCalledWith(
        'novo.membro',
        'senha1234',
        'Novo Membro',
        'novo.membro@gamabrasil.com.br',
      );
    });

    it('propaga ConflictException quando o login já existe', async () => {
      (supabaseUser.createUser as jest.Mock).mockRejectedValue(
        new ConflictException('Já existe um usuário com este login.'),
      );
      const tx = fakeTx();
      await expect(
        service.create(tx, callerMembership(), {
          name: 'Já Existe',
          login: 'ja-existe',
          password: 'senha1234',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  it('rejeita quem não é owner/admin', async () => {
    const tx = fakeTx();
    await expect(
      service.update(
        tx,
        callerMembership({ role: 'sales_rep' }),
        'membership-target',
        {
          role: 'manager',
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejeita gerente que é o próprio membro', async () => {
    const tx = fakeTx();
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        managerId: 'membership-target',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRÍTICO: bloqueia rebaixar o último owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 1 });
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        role: 'sales_rep',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRÍTICO: bloqueia suspender o último owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 1 });
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        status: 'suspended',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('permite rebaixar owner quando existe outro owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 2 });
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        role: 'manager',
      }),
    ).resolves.toBeDefined();
  });

  it('permite promover sales_rep pra manager e setar managerId', async () => {
    const tx = fakeTx({
      target: targetRow({ role: 'sales_rep' }),
      activeOwnerCount: 1,
    });
    (tx.membership.findFirst as jest.Mock).mockImplementation(
      ({ where }: { where: { id?: string; status?: string } }) => {
        if (where.id === 'membership-target') {
          return Promise.resolve(targetRow({ role: 'sales_rep' }));
        }
        if (where.id === 'membership-owner') {
          return Promise.resolve(targetRow({ id: 'membership-owner' }));
        }
        return Promise.resolve(null);
      },
    );
    await expect(
      service.update(tx, callerMembership(), 'membership-target', {
        role: 'manager',
        managerId: 'membership-owner',
      }),
    ).resolves.toBeDefined();
  });

  it('remove: rejeita quem não é owner/admin', async () => {
    const tx = fakeTx();
    await expect(
      service.remove(
        tx,
        callerMembership({ role: 'sales_rep' }),
        'membership-target',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('remove: CRÍTICO bloqueia remover o último owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 1 });
    await expect(
      service.remove(tx, callerMembership(), 'membership-target'),
    ).rejects.toThrow(BadRequestException);
  });

  it('remove: permite remover owner quando existe outro owner ativo', async () => {
    const tx = fakeTx({ activeOwnerCount: 2 });
    await expect(
      service.remove(tx, callerMembership(), 'membership-target'),
    ).resolves.toBeDefined();
  });

  it('remove: permite remover sales_rep sem checar contagem de owners', async () => {
    const tx = fakeTx({
      target: targetRow({ role: 'sales_rep' }),
      activeOwnerCount: 1,
    });
    await expect(
      service.remove(tx, callerMembership(), 'membership-target'),
    ).resolves.toBeDefined();
    expect(tx.membership.count).not.toHaveBeenCalled();
  });
});
