"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback } from "react";
import { REFRESH_SESSION_KEY } from "./toast";

// router.refresh() pra quem está dentro de um modal/drawer (2026-09-03,
// segunda rodada da instabilidade dos modais).
//
// O refresh roda em segundo plano e leva alguns segundos — a lista de
// trás recarrega junto (o Next refaz também os segmentos paralelos
// inativos). Se o usuário fecha o modal antes de ele terminar, o router
// DESCARTA o resultado: em app-router-instance.js, "Navigations
// (including back/forward) take priority over any pending actions. Mark
// the pending action as discarded (so the state is never applied)". A
// lista de trás ficava como estava — foi assim que "Reabrir" fechou o
// modal com a tarefa ainda Concluída na tabela.
//
// Aqui o refresh é marcado como pendente ANTES de disparar. O Toast (no
// layout, sobrevive ao fechamento) apaga a marca quando um refresh de
// fato chega e, se ela ainda estiver de pé ao trocar de tela, dispara
// outro — ver toast.tsx. Vale também pra página cheia (sem modal): um
// router.push() pra sair dela descarta o refresh do mesmo jeito.
export function useRefresh(): () => void {
  const router = useRouter();
  return useCallback(() => {
    sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
    startTransition(() => router.refresh());
  }, [router]);
}
