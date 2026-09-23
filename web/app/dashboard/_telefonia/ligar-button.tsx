"use client";

import { useState } from "react";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import { AVISO_DE_GRAVACAO } from "@/lib/api/telefonia";
import { ligarAction, registrarChamadaAction } from "./actions";

// Botão "Ligar" ao lado de um telefone (ficha da empresa, do lead, agenda
// de contatos e tarefa de ligação). docs/telefonia-crm.md, Etapa 1.
//
// O navegador NÃO faz a ligação: ele registra a chamada no CRM e entrega
// um endereço `sip:` ao Windows, que abre o MicroSIP já discando. Quem
// avisa o CRM que a chamada começou/terminou é o script instalado na
// máquina (scripts/telefonia/) — por isso o painel abaixo continua útil
// mesmo sem ele: dá pra anotar e encerrar à mão.
//
// O lembrete do aviso de gravação fica colado no botão (decisão 1.10,
// pedida pelo usuário em 2026-09-23): o SDR precisa ver a frase no
// momento em que clica, não num manual.
export default function LigarButton({
  telefone,
  companyId,
  contactId,
  rawLeadId,
  taskId,
  rotulo = "Ligar",
}: {
  telefone: string | null | undefined;
  companyId?: string;
  contactId?: string;
  rawLeadId?: string;
  taskId?: string;
  rotulo?: string;
}) {
  const refresh = useRefresh();
  const [chamadaId, setChamadaId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");
  const [encerrada, setEncerrada] = useState(false);

  if (!telefone || !telefone.trim()) return null;

  async function handleLigar() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    const res = await ligarAction({
      telefone: telefone!.trim(),
      companyId,
      contactId,
      rawLeadId,
      taskId,
    });
    setBusy(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setChamadaId(res.chamadaId);
    setEncerrada(false);
    setObservacao("");
    // Entrega o número ao MicroSIP pelo endereço que o instalador da
    // máquina registrou (scripts/telefonia/instalar.ps1). Se a máquina não
    // tiver passado pelo instalador, o Windows não faz nada — e o painel
    // continua aberto pro SDR registrar a ligação feita de outro jeito.
    window.location.href = res.discarUri;
  }

  async function registrar(resultado?: "atendida" | "nao_atendida") {
    if (!chamadaId || busy) return;
    setBusy(true);
    setErro(null);
    const res = await registrarChamadaAction(chamadaId, {
      observacao: observacao.trim() || undefined,
      resultado,
    });
    setBusy(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setEncerrada(true);
    refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void handleLigar()}
          title={AVISO_DE_GRAVACAO}
        >
          {busy && !chamadaId ? "Chamando…" : `📞 ${rotulo}`}
        </button>
        {/* Lembrete permanente ao lado do ícone — é o que o SDR fala na
            abertura da conversa. */}
        <span className="dli-sub" style={{ margin: 0, fontSize: 11 }}>
          avise que a ligação é gravada
        </span>
      </div>

      {erro && <div className="error-banner">{erro}</div>}

      {chamadaId && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: "var(--surface-2, transparent)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            Diga na abertura: “{AVISO_DE_GRAVACAO}”
          </div>

          {encerrada ? (
            <div className="dli-sub" style={{ margin: 0 }}>
              Ligação registrada na Timeline.
            </div>
          ) : (
            <>
              <textarea
                rows={3}
                placeholder="Anotação da conversa (opcional)"
                value={observacao}
                onChange={(event) => setObservacao(event.target.value)}
                disabled={busy}
              />
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void registrar("nao_atendida")}
                >
                  Não atendeu
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => void registrar("atendida")}
                >
                  {busy ? "Salvando…" : "Salvar ligação"}
                </button>
              </div>
              <div className="dli-sub" style={{ margin: 0, fontSize: 11 }}>
                Se o computador tiver o registro automático instalado, a duração
                e o resultado entram sozinhos ao desligar — a anotação acima é
                acrescentada ao mesmo registro.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
