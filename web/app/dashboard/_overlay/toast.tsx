"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const TOAST_SESSION_KEY = "toast-msg";
// "Tem refresh pendente." Quem grava: (a) quem fecha um modal com
// router.back() depois de apagar/salvar o registro — o refresh de dentro
// cairia na URL que acabou de sumir; (b) todo useRefresh() (refresh.ts)
// disparado de dentro de modal/drawer, porque fechar antes de ele chegar
// faz o Next descartar o resultado. Quem apaga: o Toast, quando um
// refresh de fato chega (o layout é renderizado de novo, renderedAt muda).
// Se ao trocar de tela a marca ainda está de pé, o Toast dispara outro.
export const REFRESH_SESSION_KEY = "refresh-on-arrive";

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
export default function Toast({ renderedAt }: { renderedAt: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);
  const msg = searchParams.get("msg") ?? sessionMsg;
  const [visible, setVisible] = useState(false);
  const mounted = useRef(false);

  // `renderedAt` vem do layout (Date.now() no servidor): muda toda vez que
  // um refresh chega — navegação comum não re-renderiza o layout. Chegou,
  // a tela está em dia, a marca de refresh pendente cai. No primeiro
  // render (carga inteira da página) também: já veio tudo fresco.
  useEffect(() => {
    sessionStorage.removeItem(REFRESH_SESSION_KEY);
  }, [renderedAt]);

  // Mensagem por evento (ActionForm com onSuccess="stay", ficha de tarefa):
  // a tela não navega, então não há pathname novo nem ?msg= pra ler.
  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === "string" && detail) setSessionMsg(detail);
    };
    window.addEventListener("crm:toast", onToast);
    return () => window.removeEventListener("crm:toast", onToast);
  }, []);

  useEffect(() => {
    // Trocou de tela (fechou modal, abriu outro) com refresh pendente:
    // dispara de novo. A marca só cai quando o refresh chega (efeito
    // acima) — se este também for descartado por outra navegação, a
    // próxima chegada tenta outra vez.
    if (mounted.current && sessionStorage.getItem(REFRESH_SESSION_KEY)) {
      router.refresh();
    }
    mounted.current = true;
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
      // Só navega pra limpar ?msg= quando a mensagem veio da URL — um
      // replace na mesma URL sem motivo é uma navegação a mais à toa.
      if (!searchParams.get("msg")) return;
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
