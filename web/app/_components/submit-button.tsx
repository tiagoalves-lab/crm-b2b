"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

// Botão de envio padrão de TODO formulário que dispara Server Action.
//
// Motivo de existir (2026-08-13): até aqui nenhum dos 41 formulários do
// app tinha estado de "enviando" — o botão continuava clicável enquanto a
// ação corria no servidor. Como cada ação custa vários round-trips
// (Vercel → Railway → Supabase), a janela entre o clique e a resposta era
// de segundos, e um segundo clique nesse intervalo disparava a ação de
// novo: foi assim que apareceu contato duplicado na ficha da empresa.
//
// `useFormStatus` lê o estado do <form> ANCESTRAL — por isso este
// componente só funciona dentro do próprio <form>, nunca no componente
// que o renderiza. É também o motivo de ser client component: é um hook.
//
// A trava aqui é de usabilidade, não de integridade. O que garante de
// verdade que não nasce contato duplicado é o índice único parcial em
// `contacts` (prisma/schema.prisma) — este botão evita o clique acidental,
// o índice cobre corrida real (dois usuários, duas abas, rede instável).
export default function SubmitButton({
  children,
  pendingLabel,
  ...rest
}: ComponentProps<"button"> & {
  // Texto que substitui o rótulo enquanto a ação corre. Opcional: em botão
  // de ícone (className="ic"/"icon-btn") não há rótulo pra trocar, o
  // feedback é só o desabilitar + aria-busy.
  pendingLabel?: ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      {...rest}
      type="submit"
      disabled={pending || rest.disabled}
      aria-busy={pending || undefined}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
