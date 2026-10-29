"use client";

import Link, { useLinkStatus } from "next/link";

// Itens do menu do Console fiscal. Trocar de tela muda só a querystring da
// mesma página, e nesse caso o Next não mostra o loading.tsx: o clique
// ficava sem retorno nenhum até a tela nova chegar, e o usuário achou que
// o item não funcionava (2026-10-21). O "carregando…" no item clicado
// aparece na hora. Abas no topo desde 2026-10-22: o menu à esquerda
// roubava a largura que a tabela do Controle de remessas precisa.
export default function MenuFiscal({
  itens,
  ativo,
}: {
  itens: { id: string; label: string; href: string }[];
  ativo: string;
}) {
  return itens.map((item) => (
    <Link
      key={item.id}
      href={item.href}
      className={item.id === ativo ? "view-tab active" : "view-tab"}
      aria-current={item.id === ativo ? "page" : undefined}
    >
      {item.label}
      <Carregando />
    </Link>
  ));
}

function Carregando() {
  const { pending } = useLinkStatus();
  return pending ? <span className="t-sub"> · carregando…</span> : null;
}
