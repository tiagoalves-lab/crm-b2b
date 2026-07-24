import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';

interface Jwk extends JsonWebKey {
  kid: string;
}

interface JwksResponse {
  keys: Jwk[];
}

// Chaves do Supabase raramente rotacionam, mas não são estáticas pra
// sempre — 10 minutos equilibra "não martelar o endpoint a cada request"
// com "não ficar preso a uma chave revogada por muito tempo".
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Busca e cacheia o JWKS público de um projeto Supabase, resolvendo `kid`
 * para uma chave utilizável por `jsonwebtoken.verify()`.
 *
 * Implementado com `fetch`/`crypto.createPublicKey` nativos do Node (sem
 * lib de terceiros) depois que tanto `jose` quanto `jwks-rsa` (que depende
 * de `jose` por baixo) se mostraram ESM-only — o compilador TS, com
 * `module: commonjs`, baixa `import()` dinâmico pra `require()`, e o
 * `ts-jest` não sabe carregar ESM via `require()`, então qualquer teste
 * que tocasse nesse caminho quebrava com "Unexpected token 'export'".
 */
export class SupabaseJwksCache {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly jwksUrl: string) {}

  async getKey(kid: string): Promise<KeyObject> {
    if (!this.keys.has(kid) || this.isStale()) {
      await this.refresh();
    }
    const key = this.keys.get(kid);
    if (!key) {
      throw new Error(`Nenhuma chave JWKS encontrada para kid="${kid}".`);
    }
    return key;
  }

  private isStale(): boolean {
    return Date.now() - this.fetchedAt > CACHE_TTL_MS;
  }

  private refresh(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.doRefresh().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    const response = await fetch(this.jwksUrl);
    if (!response.ok) {
      throw new Error(
        `Falha ao buscar JWKS (${response.status}): ${this.jwksUrl}`,
      );
    }
    const body = (await response.json()) as JwksResponse;

    const nextKeys = new Map<string, KeyObject>();
    for (const jwk of body.keys) {
      nextKeys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    this.keys = nextKeys;
    this.fetchedAt = Date.now();
  }
}
