import { apiFetch } from "./client";

export interface BuscaEmpresaLeadResult {
  id: string;
  origem: "empresa" | "lead";
  nome: string;
  cnpj: string | null;
}

// Seletor de empresa/lead do "Nova oportunidade" (SPEC-CRM-GAMA.md
// §3.5/§4.2.1) — busca sobre a view v_busca_empresa_lead.
export function searchEmpresaLead(
  token: string,
  q: string,
): Promise<BuscaEmpresaLeadResult[]> {
  return apiFetch<BuscaEmpresaLeadResult[]>(
    `/busca-empresa-lead?q=${encodeURIComponent(q)}`,
    { token },
  );
}
