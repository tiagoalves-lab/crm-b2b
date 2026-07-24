import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/supabase-auth.guard';
import { CurrentMembership } from '../tenancy/current-membership.decorator';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// Prova a cadeia guard de auth -> resolução de Membership -> resposta
// funcionando via HTTP de verdade. Não é Fase 3 (CRUD real) — só expõe o
// que os guards globais já colocaram no request.
@Controller('me')
export class MeController {
  @Get()
  getMe(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMembership() membership: MembershipContext,
  ) {
    return { user, membership };
  }
}
