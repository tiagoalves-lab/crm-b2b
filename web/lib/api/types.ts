// Tipos espelhando as respostas do backend NestJS (src/*/  na raiz do
// repo). Sem monorepo/tipos compartilhados — os dois são projetos npm
// separados de propósito (ver CLAUDE.md) — então isso é mantido à mão.

export type MembershipRole = "owner" | "admin" | "manager" | "sales_rep" | "readonly";
export type MembershipStatus = "active" | "invited" | "suspended";

// Matriz granular de permissões (módulo × ver/criar/editar/excluir) — ver
// lib/api/permission-catalog.ts pro catálogo completo (módulos/ações/
// presets) e src/policy/permission-catalog.ts no backend (fonte da
// verdade, aplicada de verdade em cada endpoint).
export type PermissionMatrix = {
  [module: string]: { [action: string]: boolean | undefined } | undefined;
};

export interface AuthenticatedUser {
  id: string;
  email?: string;
  // user_metadata.name embutido no JWT do Supabase — usado na Timeline pra
  // mostrar o nome de quem registrou em vez de "Você" (pedido do usuário,
  // 2026-08-03). Ausente se a conta nunca teve nome preenchido.
  name?: string;
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
  // Só presentes em GET /memberships — enriquecido a partir do Supabase
  // Auth (SupabaseUserService#getIdentities), não é coluna de Membership.
  // null quando o Admin API falha ou o membro é anterior a este campo.
  login?: string | null;
  name?: string | null;
  // E-mail de CONTATO do membro (2026-08-06) — separado do login (que é
  // só o identificador de acesso, ver comentário em
  // src/memberships/supabase-user.service.ts no backend). Mesma origem/
  // limitação de name/login acima (user_metadata, não coluna).
  email?: string | null;
  // Matriz granular de PermissionMatrix — null = usa o preset padrão do
  // papel (ver permission-catalog.ts). owner/admin ignoram isto (bypass
  // total no backend), mas o campo continua vindo preenchido/null igual
  // pros dois.
  permissions?: PermissionMatrix | null;
  // Marcação "Vendedor" (2026-09-17): só quem tem entra na lista
  // "Representante" do card de oportunidade.
  vendedor?: boolean;
}

export interface MeResponse {
  user: AuthenticatedUser;
  membership: Membership;
}

export type PessoaTipo = "PF" | "PJ";

// Referência mínima de empresa embutida nas listas (GET /tasks,
// /opportunities, /activities — 2026-09-04): só o que rotula a linha.
// null quando o usuário não enxerga a empresa (RLS) — a tela mostra "—".
export interface CompanyRef {
  id: string;
  razaoSocial: string | null;
  fantasia: string | null;
  nomeParaContato: string | null;
  deletedAt: string | null;
}

export interface OpportunityRef {
  id: string;
  companyId: string;
  company: CompanyRef | null;
}

export interface Company {
  id: string;
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
  // Indicativo "EM RECUPERAÇÃO JUDICIAL" da Receita Federal, extraído da
  // razão social pra este flag (2026-08-05) — ver
  // src/common/sanitize-razao-social.ts no backend. razaoSocial já vem
  // sem esse texto quando true.
  emRecuperacaoJudicial: boolean;
  // Curva ABC de clientes (2026-08-21): A/B/C pelo peso da empresa no
  // faturamento acumulado. Gravada por um cálculo explícito (botão
  // "Calcular curva ABC" na tela Empresas), não na hora da leitura — por
  // isso vem com a data da última apuração. null = empresa sem compra, ou
  // curva nunca calculada.
  curvaAbc: "A" | "B" | "C" | null;
  curvaAbcCalculadaEm: string | null;
  // Campos fiscais estaduais (IE + indicador de IE) — dado que a Receita
  // não fornece, preenchimento manual (SPEC-CRM-GAMA.md §3.4/§4.1). Chaves
  // usadas: inscricao_estadual/indicador_ie. `indicador_ie` guarda só o
  // NÚMERO do enum do eGestor (1/2/9) — decisão do usuário, 2026-08-17,
  // substituindo o antigo checkbox booleano contribuinte_icms. Na mesma
  // data saiu a situação cadastral estadual (situacao_cadastral): a
  // situação que o CRM usa é a federal, que vem da Receita no snapshot
  // customFields.cnpj_lookup.
  customFields: Record<string, unknown>;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Vínculo com a tabela espelho do eGestor (S2.4,
  // docs/roadmap.md) — não-nulo = empresa integrada
  // (Matriz e/ou Filial). Vem só de GET /companies e GET /companies/:id.
  egestorContato: { id: string } | null;
  // Selo Cliente × Lead da ficha — régua única no backend
  // (src/companies/cliente-regra.ts: pedido no eGestor ou oportunidade
  // ganha). Só vem em GET /companies/:id.
  ehCliente?: boolean;
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
  // Só em GET /opportunities (lista): referência mínima da empresa pro card.
  company?: CompanyRef | null;
  pipelineId: string;
  stageId: string;
  ownerUserId: string;
  // Prisma Decimal serializa como string no JSON — nunca number direto.
  amount: string;
  currency: string;
  expectedCloseDate: string | null;
  // SLA automático (2026-09-16): dia em que a proposta foi pra Negociação
  // (vazio = pendente) e dia do reinício pedido pelo cliente. Ver
  // app/dashboard/pipeline/sla.ts.
  slaDueDate: string | null;
  slaRevisionDate: string | null;
  // Detalhamento livre do que está sendo negociado (2026-09-04).
  description: string | null;
  status: OpportunityStatus;
  lostReason: string | null;
  // Stand by (2026-10-22): quando foi colocada em espera. Continua "open",
  // mas sai do quadro do Pipeline; null = ativa.
  standbyAt: string | null;
  // De onde a oportunidade veio (2026-09-18). null = ciclo comercial
  // corrente, nascida no CRM. "historico-cotacoes" = carga das cotações de
  // jul-set/2025, que fica fora do funil do Painel.
  origem: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  closedAt: string | null;
  // Só em GET /opportunities (lista): alguém destacou QUEM PEDIU a lista
  // num comentário deste card e ele ainda não deu baixa (2026-09-14). É o
  // que acende "Pendência(s) para você" no card do quadro.
  pendenciaParaMim?: boolean;
}

// Chat de comentários do card de Oportunidade (feature nova, fora do
// SPEC-CRM-GAMA.md original) — mirror de TaskComment.
export interface OpportunityComment {
  id: string;
  opportunityId: string;
  authorUserId: string;
  body: string;
  // Carimbo de itens da oportunidade (2026-09-04) — nomes dos itens.
  tags: string[];
  // Mensagem espelhada de fora (2026-09-04): id na origem e nome de quem
  // escreveu lá. Preenchidos só no espelho do chat do cartão do Trello —
  // nulos em comentário escrito aqui dentro. `authorUserId` nesse caso é
  // o usuário de sistema, e a tela mostra `externalAuthor` no lugar.
  externalRef?: string | null;
  externalAuthor?: string | null;
  // Comentário fixado (2026-09-09): sobe pro topo do histórico de
  // anotações do Pipeline. Nulo = não fixado.
  pinnedAt?: string | null;
  pinnedByUserId?: string | null;
  // Membros destacados no comentário e quem já deu baixa (2026-09-14).
  // Quem está na primeira lista e fora da segunda tem pendência no card.
  mentionedUserIds?: string[];
  mentionsDoneUserIds?: string[];
  createdAt: string;
  // Edição do texto com histórico (2026-10-16): data da última edição
  // (nulo = nunca editado) e cada versão anterior, da mais antiga pra mais
  // nova. `edits` só vem no card (GET da oportunidade e PATCH do texto);
  // as outras rotas devolvem o comentário sem ele.
  editedAt?: string | null;
  edits?: OpportunityCommentEdit[];
}

export interface OpportunityCommentEdit {
  id: string;
  bodyBefore: string;
  bodyAfter: string;
  // Usuário de sistema quando a correção veio do Trello.
  editedByUserId: string;
  editedAt: string;
}

// Linha do histórico de anotações do Pipeline (2026-09-09): o comentário
// com a referência mínima do card de onde ele veio.
export interface OpportunityCommentFeedItem extends OpportunityComment {
  // Se QUEM PEDIU já leu a anotação (2026-09-17) — cada pessoa tem o seu.
  lido: boolean;
  opportunity: {
    id: string;
    status: OpportunityStatus;
    company: CompanyRef | null;
  };
}

// Lista lateral de itens do card (2026-09-04) — o que está sendo
// negociado; cada item vira tag pra comentários e tarefas.
export interface OpportunityItem {
  id: string;
  opportunityId: string;
  name: string;
  // Valor do item (2026-09-04) — Decimal do Prisma, string no JSON.
  // Nulo = item sem preço (rótulo). Havendo qualquer item com valor,
  // a soma vira o valor da oportunidade (backend).
  amount: string | null;
  position: number;
  createdAt: string;
}

export interface OpportunityWithDetails extends Opportunity {
  comments: OpportunityComment[];
  items: OpportunityItem[];
}

export type TaskStatus = "pending" | "done";
export type TaskType = "ligacao" | "email" | "visita" | "proposta" | "followup" | "reuniao";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  // O prazo tem hora marcada? (2026-09-23) Falso = "um dia sem horário",
  // que é como toda tarefa nasceu até aqui e continua nascendo quando o
  // prazo vem de um campo de data. Verdadeiro = reunião/compromisso com
  // hora — muda como a data é formatada (Brasília × UTC) e como a régua
  // de atraso conta.
  dueHasTime: boolean;
  tipo: TaskType | null;
  contactId: string | null;
  // Pessoas envolvidas na reunião (2026-09-24) — outros contatos da mesma
  // empresa, além do contato principal. Vazio nos outros tipos.
  participantContactIds: string[];
  // Membros da tarefa (2026-09-29) — outros usuários que veem e trabalham
  // a tarefa junto com o responsável.
  memberUserIds: string[];
  assigneeUserId: string;
  companyId: string | null;
  opportunityId: string | null;
  // Só em GET /tasks (lista): empresa direta ou a oportunidade (com a
  // empresa dela) pra rotular o Vínculo sem baixar a base de empresas.
  company?: CompanyRef | null;
  opportunity?: OpportunityRef | null;
  // Carimbo de itens da oportunidade de origem (2026-09-04) — vazio em
  // tarefa vinculada só a empresa.
  tags: string[];
  status: TaskStatus;
  createdBy: string;
  createdAt: string;
  // Só em GET /tasks (lista) — SPEC-CRM-GAMA.md §4.3, ícones de contagem.
  // Ausente em GET /tasks/:id (TaskWithDetails traz os arrays inteiros).
  _count?: { checklistItems: number; comments: number; attachments: number };
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
  // Empresa direta ou da oportunidade (2026-09-29) — rótulo da ficha
  // mesmo quando quem abre é membro da tarefa e não enxerga a empresa.
  company?: CompanyRef | null;
  opportunity?: OpportunityRef | null;
}

export interface Activity {
  id: string;
  type: "note" | "call" | "email" | "stage_change" | "field_update";
  payload: Record<string, unknown>;
  actorUserId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  // Só em GET /activities (lista) — rótulo de empresa em "Últimas atividades".
  company?: CompanyRef | null;
  opportunity?: OpportunityRef | null;
  // Só em GET /activities (lista) — em evento de tarefa, quem está com ela.
  taskAssigneeUserId?: string | null;
  // Contato vinculado (2026-08-05) — obrigatório no back quando
  // payload.subtipo é ligação/reunião/visita/e-mail; o nome pra exibição
  // já vem denormalizado em payload.contatoNome (sem precisar de JOIN).
  contactId: string | null;
  occurredAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SalesHistory {
  id: string;
  companyId: string;
  codVenda: string;
  // De qual conta do eGestor a venda veio — o código da venda é numeração
  // por conta, só é único junto com isto.
  estabelecimento: "matriz" | "filial";
  dtVenda: string;
  // Prisma Decimal serializa como string no JSON — nunca number direto.
  valorTotal: string;
  situacaoOs: string | null;
  // Vendedor da venda no eGestor. `vendedorUserId` nulo = vendedor sem
  // membro correspondente no CRM (ex.: quem já saiu) — o nome continua
  // valendo pra exibição.
  codVendedor: string | null;
  vendedorNome: string | null;
  vendedorUserId: string | null;
  fonte: string;
  createdAt: string;
}

// Agenda de contatos de uma empresa (feature nova, fora do
// SPEC-CRM-GAMA.md original) — reusada na ficha de Leads via
// RawLead.promotedCompanyId, sem tabela própria de lead.
export interface Contact {
  id: string;
  workspaceId: string;
  companyId: string;
  nome: string;
  cargo: string | null;
  email: string | null;
  telefone: string | null;
  // Tomador de decisão — pedido do usuário (2026-08-03), fora do
  // protótipo original.
  decisor: boolean;
  createdAt: string;
}

export type RawLeadStatus = "novo" | "aprovado" | "descartado";

// Etapas do funil de prospecção (2026-09-23) — espelha o enum
// RawLeadEtapa do backend (src/raw-leads/etapa-funil.ts), mantido à mão
// aqui como todo tipo compartilhado entre os dois projetos npm.
export type RawLeadEtapa =
  | "entrada"
  | "andamento"
  | "reuniao"
  | "qualificado"
  | "negociacao";
export type LeadFonte = "econodata" | "apify" | "comexstat" | "manual";
export type LeadTier = "quente" | "morno" | "frio";

export interface RawLead {
  id: string;
  razaoSocial: string;
  cnpj: string | null;
  cnaePrincipal: string | null;
  cnaeDescricao: string | null;
  porte: string | null;
  uf: string | null;
  municipio: string | null;
  situacao: string | null;
  importador: boolean;
  fonte: LeadFonte;
  score: number;
  manualTier: LeadTier | null;
  status: RawLeadStatus;
  // Etapa do funil de prospecção (2026-09-23) — coluna do quadro Kanban
  // da Prospecção. Descartado não é etapa: continua em `status`.
  etapa: RawLeadEtapa;
  promotedCompanyId: string | null;
  // Tags livres de organização do usuário (2026-08-05, fora do
  // SPEC-CRM-GAMA.md original) — não confundir com companies.tags (marcador
  // de sistema "lead-triagem"), coluna própria em raw_leads.
  tags: string[];
  // Segmento de negócio (2026-08-05, mesmo pedido) — valor único, não
  // array como tags acima.
  segmento: string | null;
  // Mesmo indicativo de Company.emRecuperacaoJudicial acima — coluna
  // própria em raw_leads (não deriva da company associada).
  emRecuperacaoJudicial: boolean;
  // Só vem na listagem (GET /raw-leads): interação mais recente da
  // Timeline da empresa do lead.
  ultimoContato?: string | null;
  // Dono do lead — carteira do representante (2026-08-06). Exposto na
  // tabela da Prospecção a partir de 2026-09-18 ("inclua uma coluna
  // representante para saber de quem é o lead"). null = sem dono, caso
  // das empresas que vieram da carga antiga.
  ownerUserId: string | null;
  // Datas de passagem de faixa do funil (2026-09-21) — é o que permite ao
  // Painel medir MOVIMENTO num período em vez de estoque acumulado.
  // null = passagem anterior a este registro, ou que não aconteceu.
  // Andamento e Reunião desde 2026-10-21 (vale a primeira entrada).
  andamentoAt: string | null;
  reuniaoAt: string | null;
  qualifiedAt: string | null;
  convertedAt: string | null;
  discardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Integração eGestor — tela "Integração eGestor" (Administração, só
// owner/admin). Espelha EgestorContatoConsolidado (backend), ver
// docs/roadmap.md itens 9.3/9.6 e docs/api-egestor-contatos.md.
export type EgestorContatoStatus = "so_matriz" | "so_filial" | "ambos_iguais" | "ambos_diferentes";

// Payload cru de um lado (Matriz ou Filial) — só os campos que a Gama
// sincroniza (CAMPOS_CONTATO no backend), sem tipagem campo a campo pelo
// mesmo motivo do backend (EgestorContatoRaw): é lido de volta como blob
// só pra montar o diff na tela de correção.
export type EgestorContatoRaw = Record<string, unknown> & {
  codigo: number | string;
  nome?: string;
};

// Cadastro de Company (CRM) com o mesmo CNPJ desta linha — 3ª fonte de
// comparação ao lado de Matriz/Filial (pedido do usuário, 2026-08-13, na
// esteira da sanitização em lote via cartão CNPJ). `null` quando nenhuma
// Company do workspace tem este CNPJ. Mesmo grupo de campos de
// CAMPOS_SEFAZ/CAMPOS_CRM do backend — nunca e-mail/telefone.
export interface CrmContatoFonte {
  razaoSocial: string | null;
  fantasia: string | null;
  nomeParaContato: string | null;
  cpfCnpj: string | null;
  emails: string[];
  fones: string[];
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  uf: string | null;
  cidade: string | null;
  inscricaoEstadual: string | null;
  // Derivado do bloco "Dados estaduais (SEFAZ / ICMS)" da ficha da empresa
  // (Inscrição Estadual + "Contribuinte de ICMS") — enum 1/2/9 do eGestor.
  // `null` quando o cadastro não afirma nada sobre isso.
  indicadorIE: string | null;
}

export interface EgestorContatoConsolidado {
  id: string;
  cpfCnpj: string;
  status: EgestorContatoStatus;
  codigoMatriz: string | null;
  codigoFilial: string | null;
  nomeMatriz: string | null;
  nomeFilial: string | null;
  dadosMatriz: EgestorContatoRaw | null;
  dadosFilial: EgestorContatoRaw | null;
  camposDiferentes: string[];
  companyId: string | null;
  crm: CrmContatoFonte | null;
  // Campos onde o CRM diverge de Matriz e/ou Filial, mesmo quando os dois
  // JÁ SÃO IGUAIS entre si (fora de `camposDiferentes`, que só compara
  // Matriz×Filial) — pedido do usuário, 2026-08-14: sem isso, empresa com
  // Matriz==Filial mas desatualizada em relação ao CRM nunca aparecia como
  // precisando de correção. Vazio pra so_matriz/so_filial.
  crmCamposDivergentes: string[];
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

// Histórico legível de interações (docs/roadmap.md, "Criar log das
// interações de requisições de API", 2026-08-13) — botão "Histórico de
// requisições" na tela Integração eGestor. Espelha EgestorInteractionLog
// (backend): "crm" é ação manual (Sincronizar/Promover/Corrigir/
// Consolidar/Corrigir com SEFAZ/Completar), "egestor_matriz"/
// "egestor_filial" é processamento automático via webhook daquela conta.
export type EgestorInteractionOrigin = "crm" | "egestor_matriz" | "egestor_filial";

export interface EgestorInteractionLog {
  id: string;
  occurredAt: string;
  origin: EgestorInteractionOrigin;
  action: string;
  summary: string;
}

// Um item dentro de uma venda — o que de fato foi comprado. `tipo` separa
// mercadoria de mão de obra, que é o que sustenta as abas "ABC de
// Produtos" e "Serviços" da ficha da empresa.
export interface SalesHistoryItem {
  id: string;
  salesHistoryId: string;
  companyId: string;
  tipo: "produto" | "servico";
  codProduto: string | null;
  descricao: string;
  // Prisma Decimal serializa como string no JSON — nunca number direto.
  quantidade: string;
  valorTotal: string;
  custoTotal: string | null;
  createdAt: string;
}
