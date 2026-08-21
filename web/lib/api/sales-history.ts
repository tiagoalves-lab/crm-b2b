import { apiFetch } from "./client";
import type { SalesHistory, SalesHistoryItem } from "./types";

export function listSalesHistory(
  token: string,
  options: { companyId?: string } = {},
): Promise<SalesHistory[]> {
  const query = new URLSearchParams();
  if (options.companyId) query.set("companyId", options.companyId);
  const qs = query.toString();
  return apiFetch<SalesHistory[]>(`/sales-history${qs ? `?${qs}` : ""}`, { token });
}

// Itens das vendas (o que foi comprado), base das abas "ABC de Produtos"
// e "Serviços" da ficha. Rota separada da de vendas de propósito — a
// lista de Empresas só precisa do total por venda.
export function listSalesHistoryItems(
  token: string,
  options: { companyId?: string } = {},
): Promise<SalesHistoryItem[]> {
  const query = new URLSearchParams();
  if (options.companyId) query.set("companyId", options.companyId);
  const qs = query.toString();
  return apiFetch<SalesHistoryItem[]>(`/sales-history/itens${qs ? `?${qs}` : ""}`, { token });
}
