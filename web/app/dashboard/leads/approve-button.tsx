"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { approveLeadForOpportunityAction } from "./actions";

// Botão "Aprovar para Lead" do cabeçalho da ficha (feita client-side, ao
// contrário de Descartar, que continua <form action> simples) porque
// precisa reagir ao resultado sem navegar: depois de aprovar, pergunta se
// o usuário quer já cadastrar uma oportunidade pra empresa recém-criada —
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
        Aprovar para Lead
      </button>
      {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}

      {approvedCompanyId && (
        <div className="overlay open" onClick={() => setApprovedCompanyId(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Lead aprovado</div>
            </div>
            <div className="modal-body">
              <p className="sub">Deseja cadastrar uma oportunidade agora para esta empresa?</p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setApprovedCompanyId(null)}>
                Não
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSim}>
                Sim
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
