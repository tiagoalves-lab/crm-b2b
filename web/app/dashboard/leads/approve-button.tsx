"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { approveLeadForOpportunityAction } from "./actions";

// Botão "Converter lead" do cabeçalho da ficha — era "Aprovar para Lead"
// até 2026-09-18, renomeado a pedido do usuário pra falar a língua da
// jornada (Prospect → Lead qualificado → Lead convertido, decisão 6.6).
// É client-side, ao contrário de Descartar (que continua <form action>
// simples), porque precisa reagir ao resultado sem navegar: depois de
// converter, pergunta se o usuário quer já cadastrar a proposta —
// modal próprio (reaproveita as classes .overlay/.modal do OverlayModal,
// mas sem depender do slot @modal de rota interceptada, já que fecha por
// estado local, não por navegação).
export default function ApproveLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvedCompanyId, setApprovedCompanyId] = useState<string | null>(null);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    const res = await approveLeadForOpportunityAction(leadId);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setApprovedCompanyId(res.data.id);
    refresh();
  }

  function handleSim() {
    if (approvedCompanyId) {
      router.push(`/dashboard/pipeline/nova?companyId=${approvedCompanyId}`);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ width: 150, justifyContent: "center" }}
        disabled={busy}
        onClick={() => void handleApprove()}
      >
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        Converter lead
      </button>
      {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}

      {approvedCompanyId && (
        <div className="overlay open" onClick={() => setApprovedCompanyId(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Lead convertido</div>
            </div>
            <div className="modal-body">
              <p className="sub">
                A empresa saiu da triagem. Cadastrar a proposta agora? É a proposta que
                coloca a empresa em Leads convertidos.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setApprovedCompanyId(null)}>
                Depois
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSim}>
                Cadastrar proposta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
