"use client";

import { useEffect, useState } from "react";
import { useRefresh } from "@/app/dashboard/_overlay/refresh";
import type { CnpjLookupResult } from "@/lib/api/companies";
import { setLeadCadastroAction } from "./actions";
import { cadastroFromLookup, formatCnpj } from "./cnpj-lookup-fields";

// Editor de CNPJ na aba "Dados cadastrais" da ficha do lead (pedido do
// usuário, 2026-09-04): o lead do formulário do Meta chega sem CNPJ, e é
// aqui que o vendedor completa na hora da qualificação. Ao salvar, consulta
// a Receita (mesma busca por CNPJ do "Novo lead") e manda tudo de uma vez —
// CNPJ, razão social, CNAE, porte, situação, cidade/UF — pro backend
// regravar o lead e recalcular o score. Se a consulta falhar (Receita fora
// do ar, CNPJ não encontrado), oferece salvar só o CNPJ.
//
// Dentro de modal/drawer o refresh é via useRefresh(), nunca
// router.refresh() direto (ver _overlay/refresh.ts).
export default function LeadCnpjEditor({
  leadId,
  cnpj,
}: {
  leadId: string;
  cnpj: string | null;
}) {
  const refresh = useRefresh();
  const [value, setValue] = useState(cnpj ?? "");
  const [editing, setEditing] = useState(!cnpj);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  // Mesmo motivo do useEffect em LeadSegmentoEditor: a instância sobrevive
  // ao refresh, então sincroniza com a prop quando ela mudar.
  useEffect(() => {
    setValue(cnpj ?? "");
    setEditing(!cnpj);
  }, [cnpj]);

  function digitsOrError(): string | null {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 14) {
      setError("CNPJ precisa ter 14 dígitos.");
      return null;
    }
    return digits;
  }

  async function persist(input: Parameters<typeof setLeadCadastroAction>[1], sucesso: string) {
    setBusy(true);
    setError(null);
    const res = await setLeadCadastroAction(leadId, input);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return false;
    }
    setSaved(sucesso);
    setEditing(false);
    setLookupFailed(false);
    refresh();
    return true;
  }

  async function consultarESalvar() {
    const digits = digitsOrError();
    if (!digits) return;
    setBusy(true);
    setError(null);
    setLookupFailed(false);
    try {
      const res = await fetch(`/api/cnpj?cnpj=${digits}`);
      const data = (await res.json()) as CnpjLookupResult & { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? "Não foi possível consultar o CNPJ.");
      }
      const cadastro = cadastroFromLookup(data);
      await persist(
        { ...cadastro, cnpj: digits },
        cadastro.emRecuperacaoJudicial
          ? "Cadastro completado pela Receita — atenção: empresa em recuperação judicial."
          : "Cadastro completado pela Receita Federal.",
      );
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Erro ao consultar CNPJ.");
      setLookupFailed(true);
    }
  }

  async function salvarSoCnpj() {
    const digits = digitsOrError();
    if (!digits) return;
    await persist({ cnpj: digits }, "CNPJ salvo (sem os dados da Receita).");
  }

  if (!editing) {
    return (
      <div>
        <span>{formatCnpj(cnpj) || "—"}</span>{" "}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 6 }}
          onClick={() => {
            setSaved(null);
            setEditing(true);
          }}
        >
          Alterar
        </button>
        {saved && (
          <div className="t-sub" style={{ color: "var(--green)", marginTop: 4 }}>
            ✓ {saved}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="row-form">
        <input
          className="segmento-input"
          placeholder="00.000.000/0000-00"
          value={value}
          disabled={busy}
          maxLength={20}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void consultarESalvar();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void consultarESalvar()}
        >
          {busy ? "Consultando…" : "Consultar Receita e salvar"}
        </button>
        {cnpj && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => {
              setValue(cnpj);
              setError(null);
              setLookupFailed(false);
              setEditing(false);
            }}
          >
            Cancelar
          </button>
        )}
      </div>
      {error && (
        <div className="t-sub" style={{ color: "var(--danger)", marginTop: 4 }}>
          {error}
        </div>
      )}
      {lookupFailed && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 6 }}
          disabled={busy}
          onClick={() => void salvarSoCnpj()}
        >
          Salvar só o CNPJ, sem consultar
        </button>
      )}
      <p className="t-sub" style={{ marginTop: 6 }}>
        Preencha o CNPJ e o CRM completa razão social, CNAE, porte e situação pela Receita Federal,
        recalculando o score.
      </p>
    </div>
  );
}
