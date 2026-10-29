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
// regravar o lead. Se a consulta falhar (Receita fora
// do ar, CNPJ não encontrado), oferece salvar só o CNPJ.
//
// Dentro de modal/drawer o refresh é via useRefresh(), nunca
// router.refresh() direto (ver _overlay/refresh.ts).
export default function LeadCnpjEditor({
  leadId,
  cnpj,
  podeAlterar = true,
}: {
  leadId: string;
  cnpj: string | null;
  // false = lead descartado: só o botão de reconsultar a Receita.
  podeAlterar?: boolean;
}) {
  const refresh = useRefresh();
  const [value, setValue] = useState(formatCnpj(cnpj));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  // Mesmo motivo do useEffect em LeadSegmentoEditor: a instância sobrevive
  // ao refresh, então sincroniza com a prop quando ela mudar.
  useEffect(() => {
    setValue(formatCnpj(cnpj));
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
    setLookupFailed(false);
    refresh();
    return true;
  }

  // `cnpjAtual` (2026-10-07): botão "Buscar dados na Receita" da leitura
  // reconsulta o CNPJ já salvo sem passar pelo modo de edição — mesmo
  // recurso do "Buscar dados" da ficha de empresa.
  async function consultarESalvar(cnpjAtual?: string) {
    const digits = cnpjAtual ? cnpjAtual.replace(/\D/g, "") : digitsOrError();
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

  // Mesma caixa "Consultar CNPJ na Receita" da ficha da empresa
  // (2026-10-28) — o cartão da Receita aparece logo abaixo (CartaoReceita).
  // Lead descartado: campo travado, o botão só reconsulta o CNPJ salvo.
  return (
    <div className="cnpj-search">
      <form
        className="cnpj-search-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(null);
          void consultarESalvar(podeAlterar ? undefined : (cnpj ?? undefined));
        }}
      >
        <div className="field">
          <label>Consultar CNPJ na Receita</label>
          <input
            placeholder="00.000.000/0001-00"
            value={podeAlterar ? value : formatCnpj(cnpj)}
            readOnly={!podeAlterar}
            disabled={busy}
            maxLength={20}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || (!podeAlterar && !cnpj)}>
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          {busy ? "Buscando…" : "Buscar dados"}
        </button>
      </form>
      {error && (
        <div className="t-sub" style={{ color: "var(--danger)", marginTop: 8 }}>
          {error}
        </div>
      )}
      {lookupFailed && podeAlterar && (
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
      {saved && (
        <div className="t-sub" style={{ color: "var(--green)", marginTop: 8 }}>
          ✓ {saved}
        </div>
      )}
      <div className="field-hint" style={{ marginTop: 8 }}>
        Puxa razão social, CNAE, endereço e situação da base da Receita Federal (via BrasilAPI). A
        Inscrição Estadual é dado da SEFAZ e entra à parte, abaixo.
      </div>
    </div>
  );
}
