"use client";

import { useEffect, useRef } from "react";

// Quem digita uma data no filtro quer aquela data: passa a "Data rápida"
// pra "Personalizado" na hora. Sem isso, a data rápida que estava
// escolhida ("Desde o início", "Últimos 30 dias"...) vencia e a data
// digitada era ignorada ao gerar (relato do usuário, 2026-10-28). Vai
// dentro do formulário de filtros; não desenha nada. `campo` é o nome do
// select da data rápida.
export default function PersonalizadoAoDigitar({ campo = "periodo" }: { campo?: string }) {
  const marca = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = marca.current?.closest("form");
    if (!form) return;
    const aoMudar = (e: Event) => {
      const alvo = e.target as HTMLInputElement;
      if (alvo.name !== "inicio" && alvo.name !== "fim") return;
      const periodo = form.elements.namedItem(campo);
      if (periodo instanceof HTMLSelectElement) periodo.value = "personalizado";
    };
    form.addEventListener("change", aoMudar);
    form.addEventListener("input", aoMudar);
    return () => {
      form.removeEventListener("change", aoMudar);
      form.removeEventListener("input", aoMudar);
    };
  }, [campo]);

  return <span ref={marca} hidden />;
}
