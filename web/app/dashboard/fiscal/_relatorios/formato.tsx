// Formatação comum das telas do Console fiscal.

export const PAGINA = "/dashboard/fiscal";

// Valor zerado aparece como R$ 0,00, igual ao eGestor — só o que não se
// aplica à nota (ICMS e IPI de serviço, ISS de produto) fica "—". Zero e
// "não se aplica" são coisas diferentes na conferência de imposto.
export function brlOuZero(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dataBR(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function nomeEstab(e: string): string {
  return e === "matriz" ? "Matriz" : "Filial";
}

export function Situacao({ valor }: { valor: string }) {
  const classe =
    valor === "autorizada" ? "pill pill-green" : valor === "cancelada" ? "pill pill-red" : "pill pill-gray";
  const rotulo: Record<string, string> = {
    autorizada: "Autorizada",
    cancelada: "Cancelada",
    inutilizada: "Inutilizada",
    denegada: "Denegada",
    rejeitada: "Rejeitada",
    cancelamento_pendente: "Cancelamento pendente",
    pendente: "Pendente",
  };
  return <span className={classe}>{rotulo[valor] ?? valor}</span>;
}

export const NUM = { textAlign: "right" as const, whiteSpace: "nowrap" as const };

// Valor sem o "R$" — coluna "Valor (R$)" do Controle de remessas, no
// formato da planilha do usuário.
export function numeroBR(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  const n = Number(valor);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

// Situação do retorno de uma remessa (decisão 7.5).
export const SITUACAO_RETORNO = {
  aberta: { rotulo: "Em aberto", classe: "pill pill-red", ajuda: "Nenhuma nota de retorno ligada" },
  parcial: {
    rotulo: "Parcial",
    classe: "pill pill-amber",
    ajuda: "Os retornos ligados não cobrem o valor todo da remessa",
  },
  retornada: { rotulo: "Retornada", classe: "pill pill-green", ajuda: "Os retornos ligados cobrem o valor da remessa" },
} as const;

export const ORDEM_SITUACAO_RETORNO = ["aberta", "parcial", "retornada"] as const;

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// CNPJ (14 dígitos) ou CPF (11) com a pontuação, só pra exibição.
export function documentoBR(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return doc ?? "";
}

// "Remessa de mercadoria ou bem p/ demonstração" → "Demonstração", no
// jeito curto da planilha do usuário. O texto inteiro fica no title.
export function operacaoCurta(descricao: string | null): string {
  if (!descricao) return "—";
  const d = descricao.toLowerCase();
  if (d.includes("demonstra")) return "Demonstração";
  if (d.includes("conserto") || d.includes("reparo")) return "Conserto/reparo";
  if (d.includes("ativo imobilizado") && d.includes("uso fora")) return "Ativo imobilizado p/ uso fora";
  if (d.includes("exposi") || d.includes("feira")) return "Exposição/feira";
  if (d.includes("comodato")) return "Comodato";
  if (d.includes("consigna")) return "Consignação";
  if (d.includes("industrializa")) return "Industrialização";
  if (d.includes("armazen") || d.includes("depósito")) return "Armazenagem/depósito";
  if (d.includes("vasilhame") || d.includes("sacaria")) return "Vasilhame";
  const curta = descricao.replace(/^remessa d[eo] .*? p\/ /i, "");
  return curta.charAt(0).toUpperCase() + curta.slice(1);
}
