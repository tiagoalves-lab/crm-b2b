import { apiFetch } from "./client";
import type { SalesHistory } from "./types";

export function listSalesHistory(
  token: string,
  options: { companyId?: string } = {},
): Promise<SalesHistory[]> {
  const query = new URLSearchParams();
  if (options.companyId) query.set("companyId", options.companyId);
  const qs = query.toString();
  return apiFetch<SalesHistory[]>(`/sales-history${qs ? `?${qs}` : ""}`, { token });
}
