// Cores exatas das 4 stages do protótipo (gama-crm-mvp.html, DB.dealStages)
// — não existe coluna de cor em Stage no schema real, então derivamos pela
// ordem (1-indexed). Fechamento (2026-10-22) é um coral, pra não repetir o
// lilás da primeira; Propostas aprovadas (2026-10-28, 4ª) é um verde, e
// Negociação/Fechamento mantêm as cores que já tinham. Cicla se o
// workspace tiver mais stages.
// Mesmas cores do e-mail (src/reports/report-template.ts, CORES_ETAPA).
const PALETTE = ["#9b7fe0", "#4a9fe0", "#5dcaa5", "#7cb342", "#f2a71b", "#e5735f"];

export function stageColor(order: number): string {
  const index = Math.max(0, order - 1) % PALETTE.length;
  return PALETTE[index];
}
