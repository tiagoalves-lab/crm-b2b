import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marca uma rota como isenta do SupabaseAuthGuard/TenantMembershipGuard
// globais — usar só em rotas que genuinamente não precisam de usuário
// autenticado (ex.: health check).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
