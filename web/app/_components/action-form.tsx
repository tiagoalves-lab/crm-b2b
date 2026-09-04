"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  type ComponentProps,
} from "react";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";

// Estado que toda Server Action de formulário devolve (2026-09-03) — no
// lugar de redirect()/redirectWithMessage(). `null` é o estado inicial.
export type FormState =
  | { ok: true; message?: string }
  | { ok: false; message: string }
  | null;

export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

// <form> padrão pra Server Action que DEVOLVE resultado, em vez de
// redirecionar (2026-09-03). Nasceu do travamento "Concluindo…" na ficha
// de tarefa e do "salva → fecha → abre de novo" nos outros modais: dentro
// de rota interceptada (@modal/@drawer) redirect() de Server Action ou
// não termina nunca ou pisca a tela num ciclo de navegação (só
// router.back() colapsa o slot — ver overlay-modal.tsx). Aqui:
//
// - `onSuccess="close"` (padrão): grava o toast em sessionStorage, marca
//   REFRESH_SESSION_KEY e chama router.back() — o Toast (montado no
//   layout, sobrevive ao modal) mostra a mensagem e dá router.refresh()
//   ao chegar na tela de trás, que aparece já atualizada.
// - `onSuccess="stay"`: a tela fica onde está (drawer com abas, página
//   cheia); mostra o toast por evento e dá refresh via useRefresh() — que
//   sobrevive ao usuário fechar o drawer antes de ele chegar (refresh.ts).
//
// Erro (`ok: false`) vira faixa vermelha em cima dos campos. Os botões
// de dentro continuam usando SubmitButton (useFormStatus funciona porque o
// <form> é este).
export default function ActionForm({
  action,
  onSuccess = "close",
  successMessage,
  children,
  ...rest
}: Omit<ComponentProps<"form">, "action"> & {
  action: FormAction;
  onSuccess?: "close" | "stay";
  // Sobrepõe a mensagem devolvida pela action.
  successMessage?: string;
}) {
  const router = useRouter();
  const refresh = useRefresh();
  const [state, formAction] = useActionState(action, null);
  // Cada envio produz um objeto novo; a ref evita tratar o mesmo sucesso
  // duas vezes se o componente re-renderizar por outro motivo.
  const handled = useRef<FormState>(null);

  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    const msg = successMessage ?? state.message;
    if (onSuccess === "close") {
      if (msg) sessionStorage.setItem(TOAST_SESSION_KEY, msg);
      sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
      router.back();
    } else {
      if (msg) window.dispatchEvent(new CustomEvent("crm:toast", { detail: msg }));
      refresh();
    }
  }, [state, onSuccess, successMessage, router, refresh]);

  return (
    <form {...rest} action={formAction}>
      {state && !state.ok && <div className="error-banner">{state.message}</div>}
      {children}
    </form>
  );
}
