import { listMemberships } from "@/lib/api/memberships";
import { listCommentFeed } from "@/lib/api/opportunity-comments";

// Histórico de anotações dos cards do Pipeline (2026-09-09) —
// carregamento compartilhado entre a versão modal interceptada
// (@modal/(.)pipeline/anotacoes) e a página cheia (pipeline/anotacoes,
// fallback de acesso direto pela URL), mesmo molde de _detail/load.ts.
export async function loadAnotacoes(token: string) {
  const [{ items }, memberships] = await Promise.all([
    listCommentFeed(token),
    listMemberships(token),
  ]);
  return { items, memberships };
}

export type AnotacoesData = Awaited<ReturnType<typeof loadAnotacoes>>;
