import {
  verify,
  type Algorithm,
  type JwtPayload,
  type Secret,
} from 'jsonwebtoken';

export interface SupabaseJwtClaims extends JwtPayload {
  sub: string;
  email?: string;
}

export interface VerifySupabaseJwtOptions {
  issuer: string;
  audience: string;
}

// Supabase assina com chave assimétrica (ES256 em projetos novos, RS256 em
// projetos mais antigos que migraram) — nunca aceitar HS256 aqui: um HS256
// verificado com a mesma string usada como "chave pública" abriria brecha
// pra token forjado (a chave HS256 é secreta, não pública).
const ALLOWED_ALGORITHMS: Algorithm[] = ['ES256', 'RS256'];

export function verifySupabaseJwt(
  token: string,
  publicKey: Secret,
  options: VerifySupabaseJwtOptions,
): SupabaseJwtClaims {
  const payload = verify(token, publicKey, {
    algorithms: ALLOWED_ALGORITHMS,
    issuer: options.issuer,
    audience: options.audience,
  });

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0
  ) {
    throw new Error('Token JWT sem "sub" válido.');
  }

  return payload as SupabaseJwtClaims;
}
