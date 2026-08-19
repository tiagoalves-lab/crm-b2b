import type { Membership, MembershipRole } from "@/lib/api/types";

// "readonly" (Leitura) existe no backend (MembershipRole/PolicyService),
// mas não é oferecido no combobox de cadastro/edição de membro — pedido
// direto do usuário (2026-08-06): "não vamos usar esse" papel por
// enquanto. Continua em MembershipRole/ROLE_LABELS/ROLE_PILL abaixo pra
// não quebrar a exibição de um membro que já tenha esse papel hoje (ex.:
// atribuído direto no banco), só não aparece como opção pra escolher.
export const ROLE_OPTIONS: MembershipRole[] = [
  "owner",
  "admin",
  "manager",
  "sales_rep",
];

// Gerente cadastrando um membro só pode escolher um destes dois — owner/
// admin continuam exclusivos de quem já é owner/admin (mesma restrição
// aplicada no backend, MembershipService#create — espelhada aqui só pra
// não oferecer opção que o backend vai rejeitar de qualquer forma).
export const MANAGER_CREATABLE_ROLE_OPTIONS: MembershipRole[] = [
  "manager",
  "sales_rep",
];

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Gerente",
  sales_rep: "Representante",
  readonly: "Leitura",
};

// Cor por papel, mesma lógica de stage-colors.ts (pipeline) — só pra dar
// pista visual rápida na tabela, sem carregar significado além disso.
export const ROLE_PILL: Record<MembershipRole, string> = {
  owner: "pill pill-purple",
  admin: "pill pill-blue",
  manager: "pill pill-amber",
  sales_rep: "pill pill-green",
  readonly: "pill pill-gray",
};

// GET /memberships vem enriquecido com name/login (backend consulta o
// Supabase Auth Admin API — ver SupabaseUserService#getIdentities,
// docs/seguranca.md continua valendo: a service_role key nunca entra em
// web/, quem fala com o Admin API é só o backend). Aqui só cai pro ID
// curto quando o enriquecimento falhou ou o membro é anterior a este
// campo (nunca teve name/login preenchido).
export function memberName(m: Pick<Membership, "userId" | "name">): string {
  return m.name?.trim() || `${m.userId.slice(0, 8)}…`;
}

export function memberLogin(m: Pick<Membership, "login">): string {
  return m.login?.trim() || "—";
}

export function memberEmail(m: Pick<Membership, "email">): string {
  return m.email?.trim() || "—";
}
