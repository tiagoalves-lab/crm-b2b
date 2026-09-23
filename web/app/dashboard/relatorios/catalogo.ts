// Catálogo da tela de Relatórios (molde do eGestor, pedido do usuário em
// 2026-09-23): menu de relatórios à esquerda, painel de filtros do
// relatório escolhido em cima e o resultado embaixo. Relatório novo entra
// AQUI e ganha um componente em _relatorios/ — o menu se monta sozinho a
// partir desta lista.
//
// Lista simples, sem agrupamento por tema (pedido do usuário no mesmo
// dia): são poucos relatórios, e o título de grupo só tirava espaço.
// Nada de painel/dashboard aqui — indicador é assunto do menu Painel.
export interface RelatorioDef {
  // Vai na URL (?r=...).
  id: string;
  label: string;
  titulo: string;
  descricao: string;
}

export const RELATORIOS: RelatorioDef[] = [
  {
    id: "anotacoes",
    label: "Anotações da Timeline",
    titulo: "Anotações da Timeline",
    descricao:
      "Contatos registrados na Timeline das empresas — quem registrou, quando, de que tipo e o que foi anotado.",
  },
  {
    id: "tarefas-concluidas",
    label: "Tarefas concluídas",
    titulo: "Tarefas concluídas",
    descricao:
      "Tarefas marcadas como concluídas no período, da última concluída para a mais antiga.",
  },
];

export function relatorioDe(id?: string): RelatorioDef | null {
  return RELATORIOS.find((r) => r.id === id) ?? null;
}
