// Tipos espelhando as respostas do backend NestJS (src/*/  na raiz do
// repo). Sem monorepo/tipos compartilhados — os dois são projetos npm
// separados de propósito (ver CLAUDE.md) — então isso é mantido à mão.

export type MembershipRole = "owner" | "admin" | "manager" | "sales_rep" | "readonly";
export type MembershipStatus = "active" | "invited" | "suspended";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface Membership {
  id: string;
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  managerId: string | null;
  joinedAt: string | null;
  createdAt: string;
}

export interface MeResponse {
  user: AuthenticatedUser;
  membership: Membership;
}

export type PessoaTipo = "PF" | "PJ";

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  ownerUserId: string | null;
  parentCompanyId: string | null;
  // Cadastro completo (ex-Contact, dobrado em Company) — todos opcionais.
  razaoSocial: string | null;
  fantasia: string | null;
  nomeParaContato: string | null;
  cpfCnpj: string | null;
  tipo: PessoaTipo | null;
  dtNasc: string | null;
  dtCad: string | null;
  emails: string[];
  fones: string[];
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  tags: string[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  appliesTo: string | null;
  stages: Stage[];
}

export type OpportunityStatus = "open" | "won" | "lost";

export interface Opportunity {
  id: string;
  companyId: string;
  pipelineId: string;
  stageId: string;
  ownerUserId: string;
  // Prisma Decimal serializa como string no JSON — nunca number direto.
  amount: string;
  currency: string;
  expectedCloseDate: string | null;
  status: OpportunityStatus;
  lostReason: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  closedAt: string | null;
}

export type TaskStatus = "pending" | "done";

export interface TaskList {
  id: string;
  workspaceId: string;
  name: string;
  order: number;
  isDoneList: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  assigneeUserId: string;
  companyId: string | null;
  opportunityId: string | null;
  listId: string;
  position: number;
  status: TaskStatus;
  createdBy: string;
  createdAt: string;
}

export interface TaskChecklistItem {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: number;
  createdAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface TaskWithDetails extends Task {
  checklistItems: TaskChecklistItem[];
  comments: TaskComment[];
}

export interface Activity {
  id: string;
  type: "note" | "call" | "email" | "stage_change" | "field_update";
  payload: Record<string, unknown>;
  actorUserId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  occurredAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
