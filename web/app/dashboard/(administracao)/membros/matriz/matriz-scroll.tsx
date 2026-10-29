"use client";

import { useEffect, useRef, useState } from "react";

// Caixa com rolagem própria da matriz (pedido do usuário, 2026-10-26): a
// altura acompanha a tela de cada monitor — vai do topo da caixa até o pé
// da janela — e a rolagem acontece dentro dela, com cabeçalho e primeira
// coluna congelados (CSS .matriz-scroll em globals.css).
const FOLGA_INFERIOR = 16;

export default function MatrizScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | null>(null);

  useEffect(() => {
    function ajustar() {
      const el = ref.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top + window.scrollY;
      setAltura(Math.max(240, window.innerHeight - topo - FOLGA_INFERIOR));
    }
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  return (
    <div ref={ref} className="matriz-scroll" style={altura ? { height: altura } : undefined}>
      {children}
    </div>
  );
}
