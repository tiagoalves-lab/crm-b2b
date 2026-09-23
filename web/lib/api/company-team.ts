import { apiFetch } from "./client";
import type { MembershipRole } from "./types";

// Aba "Equipe de vendas" da ficha (pedido do usuário, 2026-09-21) — quem
// trabalha aquela empresa. Fonte da verdade e regra completa no backend,
// em src/companies/company-team.service.ts.
export interface CompanyTeam {
  companyId: string;
  // Responsável pela empresa: enxerga por ownerUserId, não por esta
  // lista. Nunca vem dentro de `userIds`.
  ownerUserId: string | null;
  userIds: string[];
  // Mudar a equipe é decisão de quem distribui carteira (gerente/
  // administrador/dono) — representante vê a lista, não edita.
  podeEditar: boolean;
}

// Administrador e proprietário enxergam toda empresa do workspace pelo
// cargo (regra 3 do usuário, 2026-09-21) — não entram na equipe nem na
// caixa de escolha. Espelha ROLES_COM_ACESSO_AUTOMATICO do backend.
export const ROLES_COM_ACESSO_AUTOMATICO: MembershipRole[] = ["owner", "admin"];

export function temAcessoAutomatico(role: MembershipRole): boolean {
  return ROLES_COM_ACESSO_AUTOMATICO.includes(role);
}

export function getCompanyTeam(token: string, companyId: string): Promise<CompanyTeam> {
  return apiFetch<CompanyTeam>(`/companies/${companyId}/equipe`, { token });
}

export function setCompanyTeam(
  token: string,
  companyId: string,
  userIds: string[],
): Promise<CompanyTeam> {
  return apiFetch<CompanyTeam>(`/companies/${companyId}/equipe`, {
    method: "PUT",
    token,
    body: { userIds },
  });
}
