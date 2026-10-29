import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Estabelecimento } from './egestor.types';

const TOKEN_URL = 'https://api.egestor.com.br/api/oauth/access_token';

// O access_token vale 900 s. Rodada que passa disso (a carga do console
// fiscal baixa um XML por segundo) pede o token por esta função, que troca
// por um novo antes de vencer: em 2026-10-21 a carga das NF-e recebidas
// teve 273 arquivos recusados com 401 depois do 15º minuto. Renovar aos 10
// minutos deixa folga pra uma listagem longa ou pras esperas de 429.
export function tokenRenovavel(
  obter: () => Promise<string>,
  validadeMs = 10 * 60_000,
): () => Promise<string> {
  let atual: { valor: string; obtidoEm: number } | null = null;
  return async () => {
    if (!atual || Date.now() - atual.obtidoEm >= validadeMs) {
      atual = { valor: await obter(), obtidoEm: Date.now() };
    }
    return atual.valor;
  };
}

// Troca o `personal_token` (de longa duração, guardado em
// EGESTOR_API_TOKEN_MATRIZ/FILIAL) por um `access_token` de curta duração
// (900s, confirmado testando contra a API real — ver
// docs/api-egestor-contatos.md). Não cacheia entre chamadas: cada sync
// pede um token novo no início; rodada longa usa tokenRenovavel() acima.
@Injectable()
export class EgestorAuthService {
  constructor(private readonly config: ConfigService) {}

  async getAccessToken(estabelecimento: Estabelecimento): Promise<string> {
    const personalToken =
      estabelecimento === 'matriz'
        ? this.config.get<string>('egestorApiTokenMatriz')
        : this.config.get<string>('egestorApiTokenFilial');

    if (!personalToken) {
      throw new InternalServerErrorException(
        `EGESTOR_API_TOKEN_${estabelecimento.toUpperCase()} não configurado.`,
      );
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'personal',
        personal_token: personalToken,
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) {
      throw new InternalServerErrorException(
        `Falha ao autenticar no eGestor (${estabelecimento}). HTTP ${res.status}: ${JSON.stringify(body)}`,
      );
    }

    return body.access_token as string;
  }
}
