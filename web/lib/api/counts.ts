import { apiFetch } from "./client";

export interface SidebarCounts {
  leads: number;
  pipeline: number;
  tarefas: number;
  empresas: number;
}

// Badges da barra lateral numa chamada só.
//
// Substitui (2026-08-13) o bloco que montava esses números no layout
// baixando as 4 listagens inteiras e contando em JS. O caso patológico era
// `listCompanies`, que pagina de 100 em 100 até o fim: com 1.165 empresas
// em produção eram 12 requisições sequenciais, e o layout roda em TODA
// navegação — inclusive depois de cada Server Action que redireciona.
// O custo agora é 1 requisição e 4 COUNT no banco.
export function getSidebarCounts(token: string): Promise<SidebarCounts> {
  return apiFetch<SidebarCounts>("/counts", { token });
}
