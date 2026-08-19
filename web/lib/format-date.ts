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
