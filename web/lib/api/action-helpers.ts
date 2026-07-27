import { redirect } from "next/navigation";
import { ApiError } from "./client";

// Mesmo padrão já usado em app/login/actions.ts: sem client JS, então erro
// de Server Action vira redirect de volta pra mesma página com
// ?error=mensagem, lido pela página e mostrado via .error-banner.
export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Erro inesperado. Tente novamente.";
}

export function redirectWithError(path: string, error: unknown): never {
  redirect(`${path}?error=${encodeURIComponent(errorMessage(error))}`);
}
