import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Estabelecimento } from './egestor.types';

const TOKEN_URL = 'https://api.egestor.com.br/api/oauth/access_token';

// Troca o `personal_token` (de longa duração, guardado em
// EGESTOR_API_TOKEN_MATRIZ/FILIAL) por um `access_token` de curta duração
// (900s, confirmado testando contra a API real — ver
// docs/api-egestor-contatos.md). Não cacheia entre chamadas: cada sync
// pede um token novo no início, mais simples que gerenciar expiração no
// meio de uma rodada.
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
