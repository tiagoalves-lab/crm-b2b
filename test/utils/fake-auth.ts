import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import type { AuthenticatedRequest } from '../../src/auth/supabase-auth.guard';
import { SupabaseAuthGuard } from '../../src/auth/supabase-auth.guard';
import { TenantMembershipGuard } from '../../src/tenancy/tenant-membership.guard';
import type {
  MembershipContext,
  MembershipRequest,
} from '../../src/tenancy/tenant-membership.guard';
import type { TenantTx } from '../../src/tenancy/tenant-context.service';

// Não dá pra forjar um JWT real do Supabase sem a chave privada do projeto
// — a verificação em si já tem cobertura própria em
// src/auth/verify-supabase-jwt.spec.ts. Para testes HTTP de rota
// protegida, a alternativa é sobrescrever os guards globais com um fake
// que popula request.user/request.membership diretamente —
// TenantContextService, PolicyService e o Postgres/RLS reais continuam
// genuínos, só a autenticação em si é stub.
//
// `overrideGuard()` do @nestjs/testing NÃO troca a implementação de guards
// registrados via APP_GUARD (testado — o guard real continua rodando).
// `overrideProvider()` funciona, mas só porque AuthModule/TenancyModule
// registram SupabaseAuthGuard/TenantMembershipGuard como providers próprios
// (não só via `useClass` dentro do provider de APP_GUARD) — sem isso não
// há token de DI pra sobrescrever.

class FakeAuthGuard implements CanActivate {
  constructor(
    private readonly userId: string,
    private readonly email: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<AuthenticatedRequest>().user = {
      id: this.userId,
      email: this.email,
    };
    return true;
  }
}

class FakeMembershipGuard implements CanActivate {
  constructor(private readonly membership: MembershipContext) {}

  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<MembershipRequest>().membership =
      this.membership;
    return true;
  }
}

export async function createFakeAuthApp(
  membership: MembershipContext,
  email = 'teste@gamabrasil.com.br',
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SupabaseAuthGuard)
    .useValue(new FakeAuthGuard(membership.userId, email))
    .overrideProvider(TenantMembershipGuard)
    .useValue(new FakeMembershipGuard(membership))
    .compile();

  const app = moduleRef.createNestApplication();
  // main.ts registra o ValidationPipe global via bootstrap() — os testes
  // e2e não passam por ali (criam a app direto do TestingModule), então
  // precisa registrar de novo aqui com a mesma config.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

// Mesmo padrão de test/rls-isolation.e2e-spec.ts e test/authz.e2e-spec.ts —
// usado aqui só pra criar fixtures (Workspace/Membership/etc.) direto via
// Prisma, sem passar pelos guards.
export function withTenant<T>(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_workspace_id = '${workspaceId}'`,
    );
    return fn(tx);
  });
}
