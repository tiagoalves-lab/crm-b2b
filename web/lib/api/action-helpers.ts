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
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(errorMessage(error))}`);
}

// Toast do protótipo (#toast em gama-crm-mvp.html) — Server Action sem
// client JS, então "mostrar toast" é redirecionar com ?msg=, lido pelo
// componente Toast (web/app/dashboard/_overlay/toast.tsx).
export function redirectWithMessage(path: string, msg: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}msg=${encodeURIComponent(msg)}`);
}
