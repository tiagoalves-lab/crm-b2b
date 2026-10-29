"use client";

import { useState } from "react";

// Menu lateral recolhível, mesmo desenho do app de orçamentos
// (gama-webapp, botão « / » no rodapé do menu). Recolhido, o sidebar vira
// um trilho só de ícones e o hover nele abre o menu inteiro por cima da
// tela (CSS .nav-collapsed em globals.css).
//
// O estado fica num cookie, não no localStorage: o layout (server
// component) lê o cookie e já desenha o shell recolhido — com
// localStorage a página nasceria aberta e fecharia depois de carregar.
export const NAV_COLLAPSED_COOKIE = "crm_nav_collapsed";

export default function NavCollapseButton({ initial }: { initial: boolean }) {
  const [recolhido, setRecolhido] = useState(initial);

  function alternar() {
    const novo = !recolhido;
    setRecolhido(novo);
    document.querySelector(".app-shell")?.classList.toggle("nav-collapsed", novo);
    document.cookie = `${NAV_COLLAPSED_COOKIE}=${novo ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      className="nav-collapse-btn"
      onClick={alternar}
      title={recolhido ? "Fixar menu aberto" : "Recolher menu"}
      aria-label={recolhido ? "Fixar menu aberto" : "Recolher menu"}
      aria-pressed={recolhido}
    >
      {recolhido ? "»" : "«"}
    </button>
  );
}
