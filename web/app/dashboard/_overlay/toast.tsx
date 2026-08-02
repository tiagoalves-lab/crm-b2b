"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const TOAST_SESSION_KEY = "toast-msg";

// Lê ?msg=...&kind=... deixado por um redirect de Server Action, mostra
// o toast do protótipo (#toast em gama-crm-mvp.html) e some sozinho,
// limpando os parâmetros da URL. Sem lib nova — mesmo padrão de
// searchParams já usado no resto do app.
//
// Fallback via sessionStorage: os forms de criação dentro de modal
// (empresas/company-form.tsx e afins) fecham com router.back() em vez de
// redirect()/router.push() — router.back() não aceita destino com
// querystring, então não dá pra levar ?msg= junto. Esses forms gravam a
// mensagem em sessionStorage antes do back(); aqui a gente lê como
// segunda fonte, só quando não veio nada pela URL.
export default function Toast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);
  const msg = searchParams.get("msg") ?? sessionMsg;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (searchParams.get("msg")) return;
    const stored = sessionStorage.getItem(TOAST_SESSION_KEY);
    if (stored) {
      sessionStorage.removeItem(TOAST_SESSION_KEY);
      setSessionMsg(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!msg) return;
    const showTimer = setTimeout(() => setVisible(true), 10);
    const hideTimer = setTimeout(() => setVisible(false), 2600);
    const clearTimer = setTimeout(() => {
      setSessionMsg(null);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("msg");
      next.delete("kind");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 3000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(clearTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg]);

  if (!msg) return null;

  return (
    <div className={`toast${visible ? " show" : ""}`}>
      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <span>{msg}</span>
    </div>
  );
}
