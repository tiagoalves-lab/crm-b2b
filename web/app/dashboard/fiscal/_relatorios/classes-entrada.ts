import type { ClasseEntrada, ItemEntrada } from "@/lib/api/fiscal";

// Classificação das notas de entrada (decisão 7.8): a lista da planilha de
// controle do usuário, agrupada pelo que a nota é pra Gama.
export const GRUPOS_CLASSE: { grupo: string; classes: { valor: ClasseEntrada; rotulo: string }[] }[] = [
  {
    grupo: "Compra",
    classes: [
      { valor: "revenda", rotulo: "Revenda" },
      { valor: "industrializacao", rotulo: "Industrialização" },
      { valor: "mat-aplic-servico", rotulo: "Mat. aplicado em serviço" },
      { valor: "imobilizado", rotulo: "Imobilizado" },
    ],
  },
  {
    grupo: "Despesa",
    classes: [
      { valor: "uso-consumo", rotulo: "Uso e consumo" },
      { valor: "viagem", rotulo: "Viagem" },
    ],
  },
  {
    grupo: "Sem compra",
    classes: [
      { valor: "remessa", rotulo: "Remessa" },
      { valor: "retorno", rotulo: "Retorno" },
      { valor: "transferencia", rotulo: "Transferência" },
      { valor: "devolucao", rotulo: "Devolução" },
      { valor: "icms", rotulo: "Crédito de ICMS" },
    ],
  },
  {
    grupo: "Problema",
    classes: [
      { valor: "cancelada", rotulo: "Cancelada" },
      { valor: "desconhecimento", rotulo: "Desconhecimento" },
    ],
  },
];

const ROTULOS = new Map(GRUPOS_CLASSE.flatMap((g) => g.classes.map((c) => [c.valor, c.rotulo] as const)));

export function rotuloClasse(classe: ClasseEntrada | null | undefined): string {
  return classe ? (ROTULOS.get(classe) ?? classe) : "—";
}

// Situação da nota pela classificação dos itens: classificada (todos os
// itens), sugerida (o que falta tem sugestão pra confirmar), pendente ou
// sem itens (nota que o eGestor só tem em resumo, sem a ciência).
export type SituacaoClassificacao = "classificada" | "sugerida" | "pendente" | "sem-itens";

export function situacaoDaNota(itens: ItemEntrada[]): SituacaoClassificacao {
  if (itens.length === 0) return "sem-itens";
  const faltam = itens.filter((i) => !i.classe);
  if (faltam.length === 0) return "classificada";
  return faltam.every((i) => i.sugestao) ? "sugerida" : "pendente";
}

// Classe única da nota (todos os itens iguais), "varias" quando os itens
// diferem, ou null quando nenhum está classificado.
export function classeDaNota(itens: ItemEntrada[]): ClasseEntrada | "varias" | null {
  const classes = new Set(itens.map((i) => i.classe).filter(Boolean));
  if (classes.size === 0) return null;
  if (classes.size > 1 || itens.some((i) => !i.classe)) return "varias";
  return [...classes][0] as ClasseEntrada;
}

// Sugestão única pros itens que faltam, ou null quando elas diferem.
export function sugestaoDaNota(itens: ItemEntrada[]): ClasseEntrada | null {
  const sugestoes = new Set(itens.filter((i) => !i.classe).map((i) => i.sugestao));
  return sugestoes.size === 1 ? ([...sugestoes][0] ?? null) : null;
}
