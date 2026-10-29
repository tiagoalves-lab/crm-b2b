import { Injectable, InternalServerErrorException } from '@nestjs/common';

const API_BASE = 'https://api.egestor.com.br/api';

interface PaginatedResponse<T> {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
  data: T[];
}

// Wrapper de GET autenticado contra a API do eGestor — paginação genérica
// (itera `page` até passar de `last_page`) + throttle simples pra respeitar
// o rate limit confirmado (60 req/min, ver docs/api-egestor-contatos.md).
// Sem cache. Única repetição automática: resposta 429 (ver enviar()) —
// qualquer outro não-2xx falha alto (lança), quem chama decide o que fazer.
@Injectable()
export class EgestorHttpService {
  // ~54 req/min de folga sobre o limite de 60 — 1100ms entre requisições
  // é simples e suficiente pro volume atual (nunca precisamos de mais de
  // ~45 páginas por conta).
  private static readonly MIN_INTERVAL_MS = 1100;
  // Espera antes de repetir uma chamada recusada com 429 ("Too Many
  // Attempts"), quando o eGestor não manda Retry-After. O limite de 60/min
  // é da CONTA: o backend em produção (webhooks) e uma carga rodando por
  // script dividem a mesma cota, e o throttle de um não enxerga o outro —
  // foi o que derrubou 211 chamadas na primeira carga do console fiscal
  // (2026-10-20). A janela do limite é de um minuto, então a última espera
  // já cobre uma janela inteira.
  private static readonly ESPERAS_429_MS = [15_000, 30_000, 60_000, 60_000];
  private lastRequestAt = 0;

  async getAllPages<T>(
    accessToken: string,
    path: string,
    params: Record<string, string>,
    // Limite de páginas pra teste de amostra (não usado em produção) —
    // pedido do usuário: "aplique um filtro de amostra só não puxe todo o
    // banco" ao validar a extração antes da carga completa.
    options?: { maxPages?: number },
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    let lastPage = 1;

    do {
      const json = await this.getPage<T>(accessToken, path, {
        ...params,
        page: String(page),
      });
      all.push(...json.data);
      lastPage = Number(json.last_page || page);
      page += 1;
    } while (
      page <= lastPage &&
      (!options?.maxPages || page <= options.maxPages)
    );

    return all;
  }

  // GET que devolve texto em vez de JSON — o XML da NF-e
  // (`GET /v1/nfe/{codigo}/xml`, console fiscal). Mesmo throttle dos
  // outros métodos: a carga inicial baixa centenas de XML em sequência.
  async getText(accessToken: string, path: string): Promise<string> {
    const res = await this.enviar(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const body = await res.text();
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Falha ao chamar eGestor GET ${path}. HTTP ${res.status}: ${body.slice(0, 300)}`,
      );
    }

    return body;
  }

  // GET de recurso único (não paginado) — ex. `GET /v1/contatos/{codigo}`,
  // usado pra buscar o registro completo e atual antes de um `PUT` de
  // correção (ver EgestorContatoCorrectionService): nunca confiar só no
  // subset de campos (`CAMPOS_CONTATO`) salvo no espelho local pra montar
  // um full update, sob risco de apagar campo que a Gama nunca sincronizou
  // (ver docs/api-egestor-contatos.md, "Perguntas em aberto" #7).
  async getOne<T>(accessToken: string, path: string): Promise<T> {
    const res = await this.enviar(`${API_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Falha ao chamar eGestor GET ${path}. HTTP ${res.status}: ${JSON.stringify(body)}`,
      );
    }

    return body as T;
  }

  // PUT de atualização — eGestor trata como full update (doc oficial não
  // deixa claro se aceita patch parcial, ver docs/api-egestor-contatos.md
  // "Perguntas em aberto" #7), então quem chama já deve montar o `payload`
  // com o objeto completo (ver getOne acima).
  async put<T>(
    accessToken: string,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const res = await this.enviar(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Falha ao chamar eGestor PUT ${path}. HTTP ${res.status}: ${JSON.stringify(body)}`,
      );
    }

    return body as T;
  }

  // POST de criação — usado só pelo fluxo "Completar Matriz ⇄ Filial"
  // (docs/roadmap.md, item 9.9): cria na conta que falta o contato que já
  // existe na outra. Diferente do `put`, não precisa de `getOne` antes —
  // é um registro novo, não tem nada pra preservar.
  async post<T>(
    accessToken: string,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const res = await this.enviar(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Falha ao chamar eGestor POST ${path}. HTTP ${res.status}: ${JSON.stringify(body)}`,
      );
    }

    return body as T;
  }

  private async getPage<T>(
    accessToken: string,
    path: string,
    params: Record<string, string>,
  ): Promise<PaginatedResponse<T>> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const res = await this.enviar(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Falha ao chamar eGestor GET ${path}. HTTP ${res.status}: ${JSON.stringify(body)}`,
      );
    }

    return body as PaginatedResponse<T>;
  }

  // Throttle + repetição em 429. Toda chamada ao eGestor passa por aqui.
  // Repetir é seguro mesmo em POST/PUT: 429 quer dizer que o eGestor
  // recusou a chamada antes de processar.
  private async enviar(url: string | URL, init: RequestInit): Promise<Response> {
    for (let tentativa = 0; ; tentativa++) {
      await this.throttle();
      const res = await fetch(url, init);
      if (res.status !== 429 || tentativa >= EgestorHttpService.ESPERAS_429_MS.length) {
        return res;
      }
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const espera =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : EgestorHttpService.ESPERAS_429_MS[tentativa];
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = EgestorHttpService.MIN_INTERVAL_MS - elapsed;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }
}
