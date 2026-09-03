"use client";

import { useMemo, useState } from "react";
import type { SalesHistory, SalesHistoryItem } from "@/lib/api/types";
import { formatDateBR } from "@/lib/format-date";

// Tabela da aba Vendas com linha expansível (pedido do usuário,
// 2026-09-01): clicar numa venda abre logo abaixo os itens (produtos e
// serviços) daquela venda. Client component só por causa do estado de
// expandido — os itens já chegam prontos do servidor (salesItems da
// ficha, os mesmos das abas ABC/Serviços), não há request extra no clique.

// Mesmo truque de coluna numérica do ficha-body.tsx (ver COL_NUM lá).
const COL_NUM = { textAlign: "right", whiteSpace: "nowrap", width: "1%" } as const;

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

export default function VendasTable({
  vendas,
  itens,
}: {
  vendas: SalesHistory[];
  itens: SalesHistoryItem[];
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  // Agrupa os itens por venda uma vez só — cada clique vira um lookup.
  const itensPorVenda = useMemo(() => {
    const mapa = new Map<string, SalesHistoryItem[]>();
    for (const item of itens) {
      const lista = mapa.get(item.salesHistoryId);
      if (lista) lista.push(item);
      else mapa.set(item.salesHistoryId, [item]);
    }
    // Dentro da venda, do item que mais pesa pro que menos pesa.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => Number(b.valorTotal) - Number(a.valorTotal));
    }
    return mapa;
  }, [itens]);

  function toggle(id: string) {
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Cód.</th>
            <th>Estabelecimento</th>
            <th>Vendedor</th>
            <th>Data</th>
            <th style={COL_NUM}>Total</th>
          </tr>
        </thead>
        <tbody>
          {vendas.map((v) => {
            const aberta = abertas.has(v.id);
            const itensDaVenda = itensPorVenda.get(v.id) ?? [];
            return (
              // Fragment com key na tupla linha+detalhe — o detalhe precisa
              // ser um <tr> irmão (não filho) pra tabela continuar válida.
              <VendaRow
                key={v.id}
                venda={v}
                aberta={aberta}
                itens={itensDaVenda}
                onToggle={() => toggle(v.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VendaRow({
  venda,
  aberta,
  itens,
  onToggle,
}: {
  venda: SalesHistory;
  aberta: boolean;
  itens: SalesHistoryItem[];
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }} title={aberta ? "Ocultar itens" : "Ver itens da venda"}>
        <td style={{ whiteSpace: "nowrap" }}>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 14,
              color: "var(--text-tertiary)",
              transition: "transform 0.15s",
              transform: aberta ? "rotate(90deg)" : "none",
            }}
          >
            ▸
          </span>
          {venda.codVenda}
        </td>
        <td>{venda.estabelecimento === "matriz" ? "Matriz" : "Filial"}</td>
        <td>{venda.vendedorNome ?? "—"}</td>
        <td>{formatDateBR(venda.dtVenda)}</td>
        <td style={COL_NUM}>{brl(Number(venda.valorTotal))}</td>
      </tr>
      {aberta && (
        <tr>
          <td colSpan={5} style={{ padding: "0 14px 14px 34px", background: "var(--surface-sunken)" }}>
            {itens.length === 0 ? (
              <p className="sub" style={{ margin: "12px 0 0" }}>
                Sem itens registrados nesta venda.
              </p>
            ) : (
              <table className="mini-table" style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Item</th>
                    <th style={COL_NUM}>Qtd.</th>
                    <th style={COL_NUM}>Valor unit.</th>
                    <th style={COL_NUM}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item) => {
                    const quantidade = Number(item.quantidade);
                    const total = Number(item.valorTotal);
                    return (
                      <tr key={item.id}>
                        <td>
                          <span className={item.tipo === "produto" ? "pill pill-blue" : "pill pill-amber"}>
                            {item.tipo === "produto" ? "Produto" : "Serviço"}
                          </span>
                        </td>
                        <td>{item.descricao}</td>
                        <td style={COL_NUM}>
                          {quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                        </td>
                        <td style={COL_NUM}>{quantidade > 0 ? brl(total / quantidade) : "—"}</td>
                        <td style={COL_NUM}>{brl(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
