import type { Prisma } from '@prisma/client';

// Referência mínima de empresa embutida nas listas de tarefas,
// oportunidades e atividades (2026-09-04, etapa 2 da performance): só o
// que o frontend precisa pra rotular a linha (companyDisplayName /
// companyRazaoSocialName) e montar o link. Antes, Painel, Tarefas e
// Pipeline baixavam a base inteira de empresas (13 páginas de 100, ~750 ms
// cada no servidor) só pra escrever o nome em meia dúzia de linhas.
//
// Passa pelo RLS como qualquer consulta: empresa que o usuário não
// enxerga vem como null e a tela mostra "—" (mesmo comportamento de
// antes, quando o GET /companies/:id individual falhava com 404).
export const COMPANY_REF_SELECT = {
  id: true,
  razaoSocial: true,
  fantasia: true,
  nomeParaContato: true,
  deletedAt: true,
} satisfies Prisma.CompanySelect;

export type CompanyRef = Prisma.CompanyGetPayload<{
  select: typeof COMPANY_REF_SELECT;
}>;

// Tarefa/atividade presa a uma oportunidade rotula pela empresa DA
// oportunidade — vem junto, sem segunda ida ao backend.
export const OPPORTUNITY_REF_SELECT = {
  id: true,
  companyId: true,
  company: { select: COMPANY_REF_SELECT },
} satisfies Prisma.OpportunitySelect;

export type OpportunityRef = Prisma.OpportunityGetPayload<{
  select: typeof OPPORTUNITY_REF_SELECT;
}>;
