import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../auth/supabase-auth.guard';

type MaybeAuthenticatedRequest = {
  user?: AuthenticatedUser;
  ip?: string;
  ips?: string[];
};

/**
 * Rate limiting chaveado por USUÁRIO, não por IP.
 *
 * Esta distinção não é preciosismo — chavear por IP quebraria o CRM
 * inteiro. Nenhum componente do frontend chama este backend direto do
 * navegador: todas as telas são Server Components/Server Actions, então
 * 100% do tráfego chega a partir dos servidores da Vercel, com um punhado
 * de IPs de saída compartilhados por *todos* os usuários. Um limite por
 * IP seria, na prática, um limite global — bastariam alguns
 * representantes navegando ao mesmo tempo pra derrubar o CRM pra todo
 * mundo (verificado em 2026-08-12; ver docs/seguranca.md, decisão 5.4).
 *
 * O fallback pra IP existe só pras rotas públicas (health check), onde
 * ainda não há usuário autenticado.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: MaybeAuthenticatedRequest): Promise<string> {
    // `request.user` é preenchido pelo SupabaseAuthGuard, que roda antes
    // deste guard (AuthModule é importado antes em app.module.ts, e este
    // guard é registrado nos providers do próprio AppModule, portanto por
    // último). Se um dia essa ordem mudar, o tracker cai no IP e o limite
    // vira global — o teste em user-throttler.guard.spec.ts trava nisso.
    const userId = req.user?.id;
    if (userId) return Promise.resolve(`user:${userId}`);

    const ip = req.ips?.length ? req.ips[0] : req.ip;
    return Promise.resolve(`ip:${ip ?? 'desconhecido'}`);
  }
}
