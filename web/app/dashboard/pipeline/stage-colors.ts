// Cores exatas das 4 stages do protótipo (gama-crm-mvp.html, DB.dealStages)
// — não existe coluna de cor em Stage no schema real, então derivamos pela
// ordem (1-indexed). Cicla se o workspace tiver mais de 4 stages (o board
// aceita adicionar stage extra via o painel de owner/admin).
const PALETTE = ["#9b7fe0", "#4a9fe0", "#5dcaa5", "#f2a71b"];

export function stageColor(order: number): string {
  const index = Math.max(0, order - 1) % PALETTE.length;
  return PALETTE[index];
}
