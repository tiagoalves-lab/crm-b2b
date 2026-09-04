const API_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(
      `API respondeu ${status}: ${
        typeof body === "object" && body !== null && "message" in body
          ? String((body as { message: unknown }).message)
          : JSON.stringify(body)
      }`,
    );
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token: string;
  // Limite de espera pela resposta. O padrão cobre a operação mais longa
  // conhecida (sincronização do eGestor, ~2 min); passar menor só em
  // chamada que sabidamente é rápida.
  timeoutMs?: number;
}

// 2026-09-03: sem limite, uma chamada que nunca respondesse deixava a
// Server Action (e a tela) presa até a Vercel matar a função. Com o
// limite ela falha com mensagem e a tela se recupera.
const DEFAULT_TIMEOUT_MS = 120_000;

// Wrapper fino sobre fetch nativo — sem lib de data-fetching (swr/
// react-query não existem no projeto, e não vale introduzir uma nova no
// meio do prazo apertado). `cache: "no-store"` por padrão: dado de CRM
// muda o tempo todo, cache do Next faria a tela mostrar informação velha.
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions,
): Promise<T> {
  if (!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL não configurada.");
  }

  // Uma linha por chamada ao backend no log da função da Vercel
  // (2026-09-04): método, rota, status e duração — é o que permite somar
  // quanto de cada tela é backend. Nunca loga token, header ou corpo.
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.token}`,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError(504, {
        message: "O servidor demorou demais para responder. Tente de novo em instantes.",
      });
    }
    throw error;
  }

  console.log(`[api] ${options.method ?? "GET"} ${path} ${res.status} ${Date.now() - started}ms`);

  const contentType = res.headers.get("content-type");
  const data: unknown = contentType?.includes("application/json")
    ? await res.json()
    : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data as T;
}
