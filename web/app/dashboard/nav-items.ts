import type { PermissionModule } from "@/lib/api/permission-catalog";
import type { MembershipRole } from "@/lib/api/types";

// Itens do menu lateral, em um módulo à parte porque duas telas precisam
// deles: o próprio nav (dashboard-nav.tsx, que desenha o ícone) e a caixa
// de busca do cabeçalho (_components/topbar-filter.tsx, que mostra o nome
// da tela atual no seletor "em <tela> / em todo o CRM").
//
// `roles` ausente = visível pra qualquer papel (padrão de Membros, cuja
// listagem todo mundo vê — só ações dentro da tela são restritas). Item
// com `roles` só aparece pra quem estiver na lista — "Integração eGestor"
// é o primeiro caso disso no nav (pedido direto do usuário, 2026-08-10):
// dispara chamada pro eGestor de produção, não é ação de representante.
export interface NavItem {
  href: string;
  label: string;
  group: string;
  icon: string;
  count?: "leads" | "pipeline" | "tarefas" | "empresas";
  roles?: MembershipRole[];
  // Item liberado por checkbox da matriz de permissões (só "ver"), em vez
  // de papel fixo — owner/admin sempre veem (bypass de hasPermission).
  permission?: PermissionModule;
  // Prefixos de URL que também acendem este item (Administração, que
  // agrupa várias telas em abas).
  matches?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Painel", group: "Comercial", icon: "painel" },
  { href: "/dashboard/leads", label: "Funil de vendas", group: "Comercial", icon: "leads", count: "leads" },
  { href: "/dashboard/pipeline", label: "Oportunidades", group: "Comercial", icon: "pipeline", count: "pipeline" },
  { href: "/dashboard/tarefas", label: "Tarefas", group: "Comercial", icon: "tarefas", count: "tarefas" },
  // Carteira de clientes entrou em Comercial (pedido do usuário,
  // 2026-09-18): o grupo "Cadastros" existia só pra ela e não agrupava
  // nada — o título do grupo vem do próprio item, então tirar o único
  // item de "Cadastros" faz o título desaparecer sozinho.
  { href: "/dashboard/empresas", label: "Carteira de clientes", group: "Comercial", icon: "empresas", count: "empresas" },
  { href: "/dashboard/relatorios", label: "Relatórios", group: "Análise", icon: "relatorios" },
  // Administração virou UM item (pedido do usuário, 2026-09-17, no molde
  // das Configurações do eGestor): as telas administrativas são abas de
  // uma página só — ver ADMIN_TABS abaixo e (administracao)/layout.tsx.
  // Abre na primeira aba, Membros, que qualquer papel enxerga.
  {
    href: "/dashboard/membros",
    label: "Administração",
    group: "Administração",
    icon: "admin",
    matches: ["/dashboard/membros", "/dashboard/e-mail-automatico", "/dashboard/registro-exclusoes", "/dashboard/integracao-egestor", "/dashboard/motivos-perda", "/dashboard/telefonia"],
  },
  // Treinamento (2026-09-17): slides de uso do CRM, item próprio logo
  // abaixo de Administração. Liberado membro a membro na tela de Permissões.
  { href: "/dashboard/treinamento", label: "Treinamento", group: "Administração", icon: "treinamento", permission: "treinamento" },
];

// Abas da Administração. `roles` segue a mesma regra do NavItem: ausente =
// qualquer papel. Membros é a única aberta a todos (a listagem é pública,
// as ações dentro dela é que são restritas).
export interface AdminTab {
  href: string;
  label: string;
  icon: string;
  roles?: MembershipRole[];
}

export const ADMIN_TABS: AdminTab[] = [
  { href: "/dashboard/membros", label: "Membros", icon: "membros" },
  { href: "/dashboard/e-mail-automatico", label: "E-mail automático", icon: "email", roles: ["owner", "admin"] },
  // Registro de exclusões (2026-09-16): quem excluiu o quê, com a cópia.
  { href: "/dashboard/registro-exclusoes", label: "Registro de exclusões", icon: "exclusoes", roles: ["owner", "admin"] },
  { href: "/dashboard/integracao-egestor", label: "Integração eGestor", icon: "egestor", roles: ["owner", "admin"] },
  { href: "/dashboard/motivos-perda", label: "Motivos de perda", icon: "motivos", roles: ["owner", "admin"] },
  // Telefonia (2026-09-23): credencial do computador que registra as
  // ligações e instruções de instalação do telefone. Qualquer papel que
  // liga precisa chegar aqui pra pegar a própria credencial.
  { href: "/dashboard/telefonia", label: "Telefonia", icon: "telefonia" },
];

// Nome da tela em que o usuário está, pra rotular o escopo da busca.
// Sub-rota herda o nome do item (o histórico do eGestor é "Integração
// eGestor"); "/dashboard" só casa exato, senão seria prefixo de tudo.
// Tela fora do menu (Busca geral) devolve null — ali não há "esta tela".
export function screenLabelFor(pathname: string): string | null {
  if (pathname === "/dashboard") return "Painel";
  let label: string | null = null;
  let matched = 0;
  for (const tab of ADMIN_TABS) {
    const hit = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    if (hit && tab.href.length > matched) {
      label = tab.label;
      matched = tab.href.length;
    }
  }
  for (const item of NAV_ITEMS) {
    if (item.href === "/dashboard") continue;
    const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && item.href.length > matched) {
      label = item.label;
      matched = item.href.length;
    }
  }
  return label;
}

export function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
