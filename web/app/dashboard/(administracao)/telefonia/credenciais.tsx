"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DispositivoTelefonia } from "@/lib/api/telefonia";
import type { Membership } from "@/lib/api/types";
import { formatDateTimeBR } from "@/lib/format-date";
import { gerarCredencialAction, revogarCredencialAction } from "./actions";

// Credencial da máquina que roda o registro automático das ligações.
// Client component porque o token em claro aparece UMA vez, na resposta —
// não dá pra mostrar isso num formulário sem JavaScript sem gravar o
// segredo em algum lugar no caminho.
export default function Credenciais({
  dispositivos,
  memberships,
  podeEscolherDono,
  apiUrl,
}: {
  dispositivos: DispositivoTelefonia[];
  memberships: Membership[];
  podeEscolherDono: boolean;
  apiUrl: string;
}) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<{ nome: string; token: string } | null>(null);

  async function gerar() {
    if (busy) return;
    if (!nome.trim()) {
      setErro("Dê um nome para a máquina (ex.: “Notebook do Arlei”).");
      return;
    }
    setBusy(true);
    setErro(null);
    const res = await gerarCredencialAction(nome.trim(), userId || undefined);
    setBusy(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setGerado({ nome: res.nome, token: res.token });
    setNome("");
    router.refresh();
  }

  async function revogar(id: string, nomeDaMaquina: string) {
    if (busy) return;
    if (!window.confirm(`Revogar a credencial de "${nomeDaMaquina}"? Aquele computador deixa de registrar ligações.`))
      return;
    setBusy(true);
    setErro(null);
    const res = await revogarCredencialAction(id);
    setBusy(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    router.refresh();
  }

  const nomeDoMembro = (id: string) => {
    const m = memberships.find((x) => x.userId === id);
    return m?.name?.trim() || m?.login?.trim() || `${id.slice(0, 8)}…`;
  };

  return (
    <>
      {erro && <div className="error-banner">{erro}</div>}

      <div className="form-grid">
        <label>
          Nome do computador
          <input
            value={nome}
            placeholder="Notebook do Arlei"
            onChange={(event) => setNome(event.target.value)}
            disabled={busy}
          />
        </label>
        {podeEscolherDono && (
          <label>
            Quem usa esse computador
            <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy}>
              <option value="">Eu mesmo</option>
              {memberships.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {nomeDoMembro(m.userId)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="row-form" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void gerar()}>
          {busy ? "Gerando…" : "Gerar credencial"}
        </button>
      </div>

      {gerado && (
        <div
          style={{
            marginTop: 12,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <strong>Credencial de “{gerado.nome}”</strong>
          <p className="sub" style={{ margin: 0 }}>
            Copie agora: ela aparece uma única vez. Cole no arquivo de
            configuração do computador, junto do endereço abaixo.
          </p>
          <code style={{ wordBreak: "break-all", fontSize: 12 }}>{gerado.token}</code>
          <p className="sub" style={{ margin: 0 }}>
            Endereço do CRM para o script: <code>{apiUrl}</code>
          </p>
        </div>
      )}

      <div className="drawer-section-title" style={{ marginTop: 20 }}>
        Computadores cadastrados
      </div>
      {dispositivos.length === 0 ? (
        <p className="sub">Nenhum computador cadastrado ainda.</p>
      ) : (
        dispositivos.map((d) => (
          <div key={d.id} className="drawer-list-item">
            <div>
              <div className="dli-title">
                {d.nome}
                {d.revogadoEm ? " — revogada" : ""}
              </div>
              <div className="dli-sub">
                {nomeDoMembro(d.userId)} ·{" "}
                {d.ultimoUsoEm
                  ? `último sinal em ${formatDateTimeBR(d.ultimoUsoEm)}`
                  : "nunca registrou uma ligação"}
              </div>
            </div>
            {!d.revogadoEm && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => void revogar(d.id, d.nome)}
              >
                Revogar
              </button>
            )}
          </div>
        ))
      )}
    </>
  );
}
