"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Opportunity, Stage } from "@/lib/api/types";
import { formatDateBR, formatDateOnlyBR } from "@/lib/format-date";
import { calcularSla, slaSelo, slaTitulo } from "./sla";

type Coluna = "empresa" | "representante" | "aberta" | "previsao" | "sla" | "valor";

// Etapa do quadro em tabela (pedido do usuário, 2026-10-29): o ícone de
// lista no título da coluna abre todas as oportunidades daquela etapa,
// com ordenação, filtro e total — pra quando a coluna tem cards demais
// pra ler rolando. Mesmo molde do modal de Stand by (standby-tile.tsx):
// cada linha abre o card.
export default function EtapaLista({
  stage,
  color,
  opportunities,
  companyName,
  ownerNameOf,
  onClose,
}: {
  stage: Stage;
  color: string;
  opportunities: Opportunity[];
  companyName: (opp: Opportunity) => string;
  ownerNameOf: (id: string) => string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState("");
  const [sort, setSort] = useState<{ key: Coluna; dir: "asc" | "desc" }>({ key: "valor", dir: "desc" });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const linhas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const base = opportunities.map((opp) => {
      const sla = calcularSla(opp);
      return {
        opp,
        empresa: companyName(opp),
        representante: ownerNameOf(opp.ownerUserId),
        aberta: opp.createdAt,
        previsao: opp.expectedCloseDate ?? "",
        sla,
        slaDias: sla.dias,
        valor: Number(opp.amount),
      };
    });
    const filtradas = q
      ? base.filter((l) => l.empresa.toLowerCase().includes(q) || l.representante.toLowerCase().includes(q))
      : base;
    const chave = (l: (typeof base)[number]) => (sort.key === "sla" ? l.slaDias : l[sort.key]);
    return [...filtradas].sort((a, b) => {
      const x = chave(a);
      const y = chave(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR");
      return sort.dir === "asc" ? r : -r;
    });
  }, [opportunities, filtro, sort, companyName, ownerNameOf]);

  const total = linhas.reduce((s, l) => s + l.valor, 0);

  function ordenar(key: Coluna) {
    setSort((atual) =>
      atual.key === key ? { key, dir: atual.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  function abrirCard(id: string) {
    onClose();
    router.push(`/dashboard/pipeline/${id}`);
  }

  function Th({ coluna, label, direita }: { coluna: Coluna; label: string; direita?: boolean }) {
    const ativa = sort.key === coluna;
    return (
      <th
        style={direita ? { textAlign: "right" } : undefined}
        aria-sort={ativa ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button type="button" className="th-sort" onClick={() => ordenar(coluna)}>
          {label}
          <span className={ativa ? "th-sort-seta ativa" : "th-sort-seta"}>
            {ativa ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="overlay open" onClick={onClose}>
      <div className="modal etapa-lista" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title etapa-lista-titulo">
            <span className="col-dot" style={{ background: color }} />
            {stage.name}
          </div>
          <input
            className="etapa-lista-busca"
            placeholder="Filtrar por empresa ou representante…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            autoFocus
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="etapa-lista-corpo">
          <table className="data-table standby-lista">
            <thead>
              <tr>
                <Th coluna="empresa" label="Empresa" />
                <Th coluna="representante" label="Representante" />
                <Th coluna="aberta" label="Aberta" />
                <Th coluna="previsao" label="Previsão" />
                <Th coluna="sla" label="SLA" direita />
                <Th coluna="valor" label="Valor" direita />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.opp.id} onClick={() => abrirCard(l.opp.id)} title="Abrir o card">
                  <td style={{ fontWeight: 600 }}>{l.empresa}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{l.representante}</td>
                  <td className="etapa-lista-data">{formatDateBR(l.opp.createdAt)}</td>
                  <td className="etapa-lista-data">
                    {l.opp.expectedCloseDate ? formatDateOnlyBR(l.opp.expectedCloseDate) : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className="card-sla etapa-lista-sla" title={slaTitulo(l.sla)}>
                      {slaSelo(l.sla)}
                    </span>
                  </td>
                  <td className="etapa-lista-valor">
                    {`${l.opp.currency} ${l.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                  </td>
                </tr>
              ))}
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--text-tertiary)" }}>
                    Nenhuma oportunidade com esse filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="modal-foot etapa-lista-rodape">
          <span>
            {linhas.length} {linhas.length === 1 ? "oportunidade" : "oportunidades"}
          </span>
          <span>
            Total: <b>{total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b>
          </span>
        </div>
      </div>
    </div>
  );
}
