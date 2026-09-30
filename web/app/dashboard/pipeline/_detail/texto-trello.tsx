import type { ReactNode } from "react";

// Mensagem espelhada do Trello (2026-09-30): o texto chega com as quebras de
// linha e o Markdown do Trello (**negrito**). O chat do card juntava tudo numa
// linha só e mostrava os asteriscos crus. Aqui só o negrito vira <strong> — é
// o que os representantes usam pra destacar cada máquina —; o resto do
// Markdown fica como texto. Sem dangerouslySetInnerHTML: o React escapa cada
// pedaço, e o texto vem de fora.
export function TextoTrello({ texto }: { texto: string }): ReactNode {
  const partes = texto.split(/\*\*([^*]+?)\*\*/g);
  return <>{partes.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p))}</>;
}
