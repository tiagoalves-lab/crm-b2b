"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
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

// Variante pro botão que envia um <form> ao qual ele NÃO pertence, via o
// atributo `form={id}` do HTML — caso do "Salvar" da tarefa, que mora no
// rodapé do modal enquanto o form vive no corpo (tarefas/_detail/
// detail-body.tsx). `useFormStatus` não serve aí: ele lê o contexto do
// form ANCESTRAL, e neste caso não há nenhum. Então escutamos o evento
// `submit` do form pelo id.
//
// O estado só volta a false quando o componente remonta. Isso é seguro
// aqui porque a Server Action associada sempre termina em redirect (tanto
// no sucesso quanto no erro, ver updateTaskDetailAction) — ou seja, todo
// envio produz uma navegação e uma árvore nova. Se algum dia esta variante
// for usada com uma ação que não redireciona, o botão ficaria travado: use
// SubmitButton (dentro do form) nesse caso.
export function ExternalSubmitButton({
  form,
  children,
  pendingLabel,
  ...rest
}: ComponentProps<"button"> & { form: string; pendingLabel?: ReactNode }) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const el = document.getElementById(form);
    if (!(el instanceof HTMLFormElement)) return;
    // Validação HTML5 reprovada não dispara `submit`, então o botão não
    // trava quando o usuário esquece um campo obrigatório.
    const onSubmit = () => setPending(true);
    el.addEventListener("submit", onSubmit);
    return () => el.removeEventListener("submit", onSubmit);
  }, [form]);

  return (
    <button
      {...rest}
      type="submit"
      form={form}
      disabled={pending || rest.disabled}
      aria-busy={pending || undefined}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
