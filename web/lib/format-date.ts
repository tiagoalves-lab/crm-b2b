// Formata data/hora sempre no fuso de Brasília (America/Sao_Paulo),
// independente de onde o `toLocaleString` roda. Achado real (2026-08-13,
// tela Histórico de requisições): páginas server component (sem "use
// client") rodam `toLocaleString` no servidor da Vercel, que roda em UTC
// — sem `timeZone` explícito, o horário exibido saía 3h adiantado (ex.:
// evento das 19:57 Brasília aparecia como "19:57" só que já em UTC, ou
// seja, era na verdade 16:57 Brasília). Em client component o navegador
// do usuário já resolveria certo sozinho (fuso local dele), mas fixar o
// fuso aqui deixa o comportamento previsível nos dois casos — a Gama é
// uma empresa brasileira, não faz sentido depender de onde o código roda
// pra decidir o fuso exibido.
export function formatDateTimeBR(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// "Chave do dia" em Brasília (yyyy-mm-dd, locale "en-CA" já devolve nesse
// formato) — pra comparar "é hoje?" sem cair na mesma armadilha de fuso:
// `Date#toDateString()`/`setHours(0,0,0,0)` sozinhos comparam no fuso de
// onde o código roda (UTC na Vercel), então perto da virada do dia em
// Brasília (21h-23h59) o servidor já acha que é o dia seguinte.
export function dayKeyBR(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// Campo "só data" (prazo da tarefa, previsão de fechamento, data da venda,
// data de abertura da empresa): o backend guarda como meia-noite UTC
// (input type="date" → 2026-08-11T00:00:00.000Z). Formatar isso em
// Brasília cai em 21h do dia ANTERIOR — a lista de Tarefas mostrava 10/08
// pra um prazo que a ficha mostrava como 11/08 (achado 2026-09-04). Só
// data se formata em UTC, sem conversão de fuso. Carimbo com hora de
// verdade (createdAt, closedAt) continua em formatDateBR/formatDateTimeBR.
export function formatDateOnlyBR(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// ── Prazo com HORA (2026-09-23) ─────────────────────────────────────────
// Até aqui todo prazo era "um dia sem hora": vinha de um <input
// type="date"> e virava meia-noite UTC, formatada em UTC (formatDateOnlyBR
// acima). Agendar reunião exige hora de verdade, e um <input
// type="datetime-local"> devolve texto SEM fuso ("2026-09-24T14:30") — se
// isso for direto pro backend, o instante gravado depende de onde o código
// rodou (UTC na Vercel), e a reunião das 14:30 vira 11:30.
//
// Brasília é UTC-3 fixo desde 2019 (o horário de verão acabou), então a
// conversão é uma constante — não precisa de biblioteca de fuso.
const OFFSET_BRASILIA = "-03:00";

// "2026-09-24T14:30" (digitado, horário de Brasília) → ISO com fuso, que é
// o que o backend grava como instante.
export function inputLocalParaISO(local: string): string {
  const texto = local.length === 16 ? `${local}:00` : local;
  return new Date(`${texto}${OFFSET_BRASILIA}`).toISOString();
}

// Caminho inverso, pra preencher o <input type="datetime-local"> com o que
// está salvo.
export function isoParaInputLocal(iso: string): string {
  const d = new Date(iso);
  const emBrasilia = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return emBrasilia.toISOString().slice(0, 16);
}

// Prazo da tarefa como a tela mostra: com hora quando foi marcada
// (instante real → Brasília), só o dia quando não (UTC, ver
// formatDateOnlyBR). Uma função só pra nenhuma tela ter que lembrar a
// regra.
export function formatPrazoBR(iso: string, comHora: boolean): string {
  if (!comHora) return formatDateOnlyBR(iso);
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
