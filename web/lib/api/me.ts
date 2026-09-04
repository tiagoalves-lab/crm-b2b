import { cache } from "react";
import { apiFetch } from "./client";
import type { MeResponse } from "./types";

// cache() do React: dentro de UMA renderização no servidor, layout, página
// e modal chamando getMe(token) com o mesmo token disparam uma requisição
// só (2026-09-03). Não atravessa requisições — cada navegação busca de novo.
export const getMe = cache((token: string): Promise<MeResponse> => {
  return apiFetch<MeResponse>("/me", { token });
});
