import { generateKeyPairSync } from 'node:crypto';
import { sign, type SignOptions } from 'jsonwebtoken';
import { verifySupabaseJwt } from './verify-supabase-jwt';

const ISSUER = 'https://test-project.supabase.co/auth/v1';
const AUDIENCE = 'authenticated';
const KID = 'test-key-1';
const SUB = '11111111-1111-1111-1111-111111111111';

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function signToken(
  overrides: Partial<{
    sub: string;
    email: string;
    iss: string;
    aud: string;
    expiresIn: SignOptions['expiresIn'];
    key: string;
  }> = {},
): string {
  return sign(
    { email: overrides.email ?? 'pessoa@gamabrasil.com.br' },
    overrides.key ?? privateKey,
    {
      algorithm: 'ES256',
      keyid: KID,
      subject: overrides.sub ?? SUB,
      issuer: overrides.iss ?? ISSUER,
      audience: overrides.aud ?? AUDIENCE,
      expiresIn: overrides.expiresIn ?? '5m',
    },
  );
}

describe('verifySupabaseJwt', () => {
  it('verifica um token válido e retorna as claims', () => {
    const token = signToken();
    const claims = verifySupabaseJwt(token, publicKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    expect(claims.sub).toBe(SUB);
    expect(claims.email).toBe('pessoa@gamabrasil.com.br');
  });

  it('rejeita token expirado', () => {
    const token = signToken({ expiresIn: '-1s' });
    expect(() =>
      verifySupabaseJwt(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow();
  });

  it('rejeita issuer diferente (token de outro projeto Supabase)', () => {
    const token = signToken({
      iss: 'https://outro-projeto.supabase.co/auth/v1',
    });
    expect(() =>
      verifySupabaseJwt(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow();
  });

  it('rejeita audience diferente', () => {
    const token = signToken({ aud: 'anon' });
    expect(() =>
      verifySupabaseJwt(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow();
  });

  it('rejeita assinatura inválida (assinado com outra chave)', () => {
    const { privateKey: otherKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const token = signToken({ key: otherKey });
    expect(() =>
      verifySupabaseJwt(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow();
  });

  it('rejeita token sem "sub"', () => {
    const token = sign({ email: 'sem-sub@gamabrasil.com.br' }, privateKey, {
      algorithm: 'ES256',
      keyid: KID,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: '5m',
    });
    expect(() =>
      verifySupabaseJwt(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow();
  });

  it('rejeita algoritmo HS256 (nunca aceitar simétrico verificando com "chave pública")', () => {
    // Se alguém forjar um token HS256 assinado com o próprio publicKey (PEM)
    // como segredo simétrico, ALLOWED_ALGORITHMS deve barrar antes disso
    // virar uma verificação (jsonwebtoken já rejeita por causa da lista
    // restrita de algorithms, mas o teste trava esse comportamento).
    const token = sign({ email: 'forjado@gamabrasil.com.br' }, publicKey, {
      algorithm: 'HS256',
      keyid: KID,
      subject: SUB,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: '5m',
    });
    expect(() =>
      verifySupabaseJwt(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow();
  });
});
