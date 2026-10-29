"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Card "Stand by" do topo do Pipeline (pedido do usuário, 2026-10-22):
// quantas oportunidades estão em espera e a menor previsão de fechamento —
// a próxima a ser retomada. As em stand by saem do quadro; o ícone abre a
// lista de todas, e cada linha abre o card.
//
// Só dado simples atravessa a fronteira servidor → cliente (rótulos já
// resolvidos em pipeline/page.tsx).
export interface StandbyRow {
  id: string;
  companyLabel: string;
  ownerLabel: string;
  amountLabel: string;
  // Previsão de fechamento já formatada ("—" quando não tem).
  retomadaLabel: string;
  desdeLabel: string;
}

export default function StandbyTile({
  rows,
  proximaRetomada,
}: {
  // Já na ordem da retomada, a mais próxima primeiro.
  rows: StandbyRow[];
  proximaRetomada: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [aberto]);

  function abrirCard(id: string) {
    setAberto(false);
    router.push(`/dashboard/pipeline/${id}`);
  }

  return (
    <>
      <div className="stat-tile purple">
        <div className="stat-tile-head">
          <div className="stat-label">Stand by</div>
          <button
            type="button"
            className="stat-tile-icone"
            title="Ver todas as oportunidades em stand by"
            aria-label="Ver todas as oportunidades em stand by"
            onClick={() => setAberto(true)}
          >
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </button>
        </div>
        <div className="stat-value">{rows.length}</div>
        <div className="sub">{proximaRetomada ? `Próxima retomada: ${proximaRetomada}` : "Nenhuma em espera"}</div>
      </div>

      {aberto && (
        <div className="overlay open" onClick={() => setAberto(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Oportunidades em Stand by · {rows.length}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberto(false)} aria-label="Fechar">
                ✕
              </button>
            </div>
            <div className="modal-body">
              {rows.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Nenhuma oportunidade em stand by.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table standby-lista">
                    <thead>
                      <tr>
                        <th>Retomada</th>
                        <th>Empresa</th>
                        <th>Representante</th>
                        <th style={{ textAlign: "right" }}>Valor</th>
                        <th>Em stand by desde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} onClick={() => abrirCard(row.id)} title="Abrir o card">
                          <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{row.retomadaLabel}</td>
                          <td>{row.companyLabel}</td>
                          <td>{row.ownerLabel}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                            {row.amountLabel}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{row.desdeLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setAberto(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
