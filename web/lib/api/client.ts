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
}

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

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const contentType = res.headers.get("content-type");
  const data: unknown = contentType?.includes("application/json")
    ? await res.json()
    : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data as T;
}
