import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { decode } from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SupabaseJwksCache } from './supabase-jwks';
import { verifySupabaseJwt } from './verify-supabase-jwt';

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  // Cache de instância (o guard é singleton no DI) — ver supabase-jwks.ts.
  private jwks: SupabaseJwksCache | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Token de autenticação ausente.');
    }

    const supabaseUrl = this.configService.get<string>('supabaseUrl');
    if (!supabaseUrl) {
      throw new Error(
        'SUPABASE_URL não configurada — obrigatória para validar o JWT do Supabase Auth.',
      );
    }

    try {
      const decoded = decode(token, { complete: true });
      const kid = decoded?.header.kid;
      if (!kid) {
        throw new Error('Token sem "kid" no header.');
      }

      const publicKey = await this.getJwks(supabaseUrl).getKey(kid);
      const claims = verifySupabaseJwt(token, publicKey, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: 'authenticated',
      });
      request.user = { id: claims.sub, email: claims.email };
      return true;
    } catch {
      throw new UnauthorizedException(
        'Token de autenticação inválido ou expirado.',
      );
    }
  }

  private getJwks(supabaseUrl: string): SupabaseJwksCache {
    if (!this.jwks) {
      this.jwks = new SupabaseJwksCache(
        `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      );
    }
    return this.jwks;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}
