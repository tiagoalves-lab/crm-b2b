"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EgestorContatoConsolidado, EgestorContatoStatus } from "@/lib/api/types";
import { completeEgestorContatoRpc, correctEgestorContatoRpc } from "./actions";
import { useTopbarQuery } from "@/app/_components/topbar-filter";

const STATUS_LABEL: Record<EgestorContatoStatus, string> = {
  so_matriz: "Só Matriz",
  so_filial: "Só Filial",
  ambos_iguais: "Iguais",
  ambos_diferentes: "Divergentes",
};
const STATUS_PILL: Record<EgestorContatoStatus, string> = {
  so_matriz: "pill pill-blue",
  so_filial: "pill pill-purple",
  ambos_iguais: "pill pill-green",
  ambos_diferentes: "pill pill-amber",
};

// Rótulo em português dos campos do eGestor mais comuns na divergência —
// mesma lista de CAMPOS_CONTATO do backend (src/integrations/egestor/
// egestor.types.ts). Campo sem entrada aqui cai no próprio nome cru.
const CAMPO_LABEL: Record<string, string> = {
  nome: "Nome",
  fantasia: "Fantasia",
  nomeParaContato: "Nome pra contato",
  cpfcnpj: "CPF/CNPJ",
  tipo: "Tipo",
  dtNasc: "Data de nascimento",
  emails: "E-mails",
  fones: "Telefones",
  logradouro: "Logradouro",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  cep: "CEP",
  codIBGE: "Código IBGE",
  uf: "UF",
  clienteFinal: "Cliente final",
  indicadorIE: "Indicador de IE",
  inscricaoMunicipal: "Inscrição municipal",
  inscricaoEstadual: "Inscrição estadual",
  obs: "Observações",
  tags: "Tags",
};

interface FailedItem {
  cpfCnpj: string;
  reason: string;
}

// Nome + código do eGestor entre parênteses (pedido do usuário,
// 2026-08-11 — "ex: (cod. 157)") — ajuda a achar o registro direto no
// eGestor sem precisar abrir a ficha. Sem nome, mostra só o código (nunca
// "— (cod. 157)"); sem os dois, "—" como já era.
function nomeComCodigo(nome: string | null, codigo: string | null): string {
  if (!nome && !codigo) return "—";
  if (!codigo) return nome!;
  return nome ? `${nome} (cod. ${codigo})` : `(cod. ${codigo})`;
}

// Resumo da 3ª fonte de comparação — o cadastro desta empresa no CRM
// (mesmo CNPJ, pedido do usuário 2026-08-13). Sem "código" (Company não
// tem um, diferente de Matriz/Filial) — razão social/fantasia + cidade/UF
// quando tiver, pra já dar um sinal visual de que bate ou não com Matriz/
// Filial sem precisar abrir "Corrigir".
function crmResumo(crm: EgestorContatoConsolidado["crm"]): string {
  if (!crm) return "—";
  const nome = crm.razaoSocial || crm.fantasia;
  if (!nome) return "—";
  const local = [crm.cidade, crm.uf].filter(Boolean).join("/");
  return local ? `${nome} (${local})` : nome;
}

// Tabela + seleção em lote da Integração eGestor (pedido do usuário,
// 2026-08-10 — "igual tem no menu de Prospecção"): checkbox na 1ª coluna,
// barra de ações acima habilitada ao selecionar, mesmo padrão de
// LeadsTable/BulkEditModal (web/app/dashboard/leads/). Diferença de
// leads: aqui não tem endpoint de bulk no backend (cada linha é uma
// chamada de escrita separada no eGestor de produção), então o "lote" é
// um loop no client chamando a RPC de cada ação por item selecionado,
// reportando sucesso/falha individual — mesma filosofia do
// BulkEditModal de leads (loop client-side, sem endpoint novo).
export default function EgestorTable({
  rows,
  counts,
  filtroAtual,
}: {
  rows: EgestorContatoConsolidado[];
  counts: Record<"todas" | EgestorContatoStatus, number>;
  filtroAtual?: EgestorContatoStatus;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: FailedItem[] } | null>(null);
  // Texto do filtro do cabeçalho (TopbarFilter em modo contexto) — a caixa
  // antiga da toolbar saiu em 2026-09-03 pra não duplicar.
  const query = useTopbarQuery();
  // Progresso do lote em curso. Contador próprio, não derivado de
  // `selected`: o loop remove cada item da seleção conforme conclui, então
  // qualquer conta feita em cima da seleção encolhe junto e nunca avança.
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);

  // Busca client-side (pedido do usuário, 2026-08-17) — mesmo desenho de
  // Empresas/Prospecção: a tela já carrega tudo (~300 linhas, sem
  // paginação de verdade), então filtrar aqui evita ida ao servidor a cada
  // tecla. Casa nome da Matriz, da Filial, o do CRM, o código do eGestor
  // (que a tabela mostra como "(cod. 1124)") e o CNPJ — este último só por
  // dígitos, pra achar tanto digitando "00506489000178" quanto colando
  // "00.506.489/0001-78".
  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const visiveis = q
    ? rows.filter((r) => {
        const alvos = [
          r.nomeMatriz,
          r.nomeFilial,
          r.crm?.razaoSocial,
          r.crm?.fantasia,
          r.codigoMatriz,
          r.codigoFilial,
        ];
        if (alvos.some((t) => t && t.toLowerCase().includes(q))) return true;
        return qDigits.length > 0 && r.cpfCnpj.includes(qDigits);
      })
    : rows;

  // Zera a seleção a cada mudança na busca. Sem isso dá pra marcar "todas",
  // buscar uma empresa e clicar em "Corrigir" achando que a ação vale pra
  // linha que está na tela — quando na verdade valeria pras centenas que a
  // busca escondeu, cada uma virando uma escrita no eGestor de produção.
  useEffect(() => {
    setSelected(new Set());
    setResult(null);
  }, [query]);

  const filtroHref = (s?: EgestorContatoStatus) =>
    s ? `/dashboard/integracao-egestor?status=${s}` : "/dashboard/integracao-egestor";

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(visiveis.map((r) => r.id)) : new Set());
  }

  // Sempre a partir das linhas VISÍVEIS — a seleção nunca pode alcançar o
  // que a busca escondeu (ver o efeito em `query` acima).
  const selecionados = visiveis.filter((r) => selected.has(r.id));
  const completaveis = selecionados.filter(
    (r) => r.status === "so_matriz" || r.status === "so_filial",
  );
  const corrigiveis = selecionados.filter((r) => r.status === "ambos_diferentes");

  async function runBulk(
    itens: EgestorContatoConsolidado[],
    executar: (item: EgestorContatoConsolidado) => Promise<{ ok: boolean; message?: string }>,
  ) {
    setBusy(true);
    setResult(null);
    setProgresso({ feitos: 0, total: itens.length });

    let ok = 0;
    let feitos = 0;
    const failed: FailedItem[] = [];
    for (const item of itens) {
      const res = await executar(item);
      if (res.ok) {
        ok += 1;
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      } else {
        failed.push({ cpfCnpj: item.cpfCnpj, reason: res.message ?? "Erro desconhecido." });
      }
      feitos += 1;
      setProgresso({ feitos, total: itens.length });
    }

    setBusy(false);
    setProgresso(null);
    setResult({ ok, failed });
    if (ok > 0) router.refresh();
  }

  function handleCompletar() {
    if (completaveis.length === 0) return;
    if (
      !window.confirm(
        `Completar Matriz ⇄ Filial em ${completaveis.length} contato(s)? Cria o contato que falta em cada um, gravando no eGestor de produção agora.`,
      )
    ) {
      return;
    }
    void runBulk(completaveis, async (item) => {
      const res = await completeEgestorContatoRpc(item.id);
      return res.ok ? { ok: true } : { ok: false, message: res.message };
    });
  }

  function handleCorrigir() {
    if (corrigiveis.length === 0) return;
    if (
      !window.confirm(
        `Corrigir ${corrigiveis.length} divergência(s) copiando o dado da Matriz pra Filial? Grava no eGestor de produção agora.`,
      )
    ) {
      return;
    }
    void runBulk(corrigiveis, async (item) => {
      const res = await correctEgestorContatoRpc(item.id, "matriz_para_filial");
      return res.ok ? { ok: true } : { ok: false, message: res.message };
    });
  }

  function handleCompletarLinha(row: EgestorContatoConsolidado) {
    const destino = row.status === "so_matriz" ? "Filial" : "Matriz";
    const origem = row.status === "so_matriz" ? "Matriz" : "Filial";
    if (
      !window.confirm(
        `Criar este contato na ${destino} usando os dados da ${origem}? Isso grava no eGestor de produção agora.`,
      )
    ) {
      return;
    }
    void runBulk([row], async (item) => {
      const res = await completeEgestorContatoRpc(item.id);
      return res.ok ? { ok: true } : { ok: false, message: res.message };
    });
  }

  return (
    <div>
      <div className="toolbar">
        <div className="seg">
          <Link href={filtroHref()} className={!filtroAtual ? "active" : undefined}>
            Todas ({counts.todas})
          </Link>
          <Link
            href={filtroHref("ambos_diferentes")}
            className={filtroAtual === "ambos_diferentes" ? "active" : undefined}
          >
            Divergentes ({counts.ambos_diferentes})
          </Link>
          <Link
            href={filtroHref("so_matriz")}
            className={filtroAtual === "so_matriz" ? "active" : undefined}
          >
            Só Matriz ({counts.so_matriz})
          </Link>
          <Link
            href={filtroHref("so_filial")}
            className={filtroAtual === "so_filial" ? "active" : undefined}
          >
            Só Filial ({counts.so_filial})
          </Link>
          <Link
            href={filtroHref("ambos_iguais")}
            className={filtroAtual === "ambos_iguais" ? "active" : undefined}
          >
            Iguais ({counts.ambos_iguais})
          </Link>
        </div>
        {q && (
          <span className="t-sub" style={{ fontSize: 13 }}>
            {visiveis.length} de {rows.length}
          </span>
        )}
      </div>

      <div className={selected.size > 0 ? "triage-bulkbar" : "triage-bulkbar hidden"}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selecionado(s)</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())} disabled={busy}>
          Limpar
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={busy || corrigiveis.length === 0}
          onClick={handleCorrigir}
          title={corrigiveis.length === 0 ? "Selecione ao menos 1 linha Divergente" : undefined}
        >
          Corrigir (Matriz → Filial) {corrigiveis.length > 0 && `(${corrigiveis.length})`}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy || completaveis.length === 0}
          onClick={handleCompletar}
          title={completaveis.length === 0 ? "Selecione ao menos 1 linha Só Matriz/Só Filial" : undefined}
        >
          Completar Matriz ⇄ Filial {completaveis.length > 0 && `(${completaveis.length})`}
        </button>
      </div>

      {/* Cada item do lote é uma chamada de escrita separada no eGestor
          (ver runBulk) — em lote grande o loop leva minutos. Mostrar o
          progresso item a item é o que impede a tela de parecer travada,
          mesmo problema que o usuário relatou no modal de correção. */}
      {progresso && (
        <div className="busy-banner" role="status" aria-live="polite">
          Gravando no eGestor… {progresso.feitos} de {progresso.total} concluído(s). Não feche esta
          janela.
        </div>
      )}

      {result && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body" style={{ padding: 12, fontSize: 13 }}>
            <b>{result.ok}</b> de <b>{result.ok + result.failed.length}</b> aplicado(s).
            {result.failed.length > 0 && (
              <>
                <div style={{ marginTop: 8, color: "var(--danger)" }}>{result.failed.length} falha(s):</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {result.failed.map((f) => (
                    <li key={f.cpfCnpj}>
                      {f.cpfCnpj}: {f.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th className="checkcol">
              <input
                type="checkbox"
                checked={visiveis.length > 0 && selected.size === visiveis.length}
                onChange={(e) => selectAll(e.target.checked)}
              />
            </th>
            <th>CNPJ</th>
            <th>Nome (Matriz)</th>
            <th>Nome (Filial)</th>
            <th>CRM</th>
            <th>Status</th>
            <th>Campos divergentes</th>
            <th style={{ textAlign: "center" }}>Empresa vinculada</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((row) => (
            <tr key={row.id} className={selected.has(row.id) ? "triage-row picked" : "triage-row"}>
              <td className="checkcol">
                <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
              </td>
              <td className="t-sub">{row.cpfCnpj}</td>
              <td>{nomeComCodigo(row.nomeMatriz, row.codigoMatriz)}</td>
              <td>{nomeComCodigo(row.nomeFilial, row.codigoFilial)}</td>
              <td className="t-sub">
                {crmResumo(row.crm)}
                {row.crmCamposDivergentes.length > 0 && (
                  <span
                    className="pill pill-amber"
                    style={{ marginLeft: 6 }}
                    title={`Diverge do CRM mesmo com Matriz e Filial iguais entre si: ${row.crmCamposDivergentes
                      .map((c) => CAMPO_LABEL[c] ?? c)
                      .join(", ")}`}
                  >
                    ⚠ diverge
                  </span>
                )}
              </td>
              <td>
                <span className={STATUS_PILL[row.status]}>{STATUS_LABEL[row.status]}</span>
              </td>
              <td className="t-sub">
                {row.camposDiferentes.length > 0
                  ? row.camposDiferentes.map((c) => CAMPO_LABEL[c] ?? c).join(", ")
                  : "—"}
              </td>
              <td style={{ textAlign: "center" }}>
                {row.companyId ? (
                  <span title="Promovida pra Company" style={{ color: "var(--green)" }}>✓</span>
                ) : (
                  <span title="Ainda não promovida" style={{ color: "var(--text-tertiary)" }}>✗</span>
                )}
              </td>
              <td>
                {/* CRM divergente abre a mesma tela mesmo com status ambos_iguais
                    (Matriz==Filial, mas os dois desatualizados em relação ao CRM
                    — pedido do usuário, 2026-08-14) — buscarParaCorrecaoExterna
                    no backend aceita esse status pras opções SEFAZ/CRM. */}
                {(row.status === "ambos_diferentes" || row.crmCamposDivergentes.length > 0) && (
                  <Link href={`/dashboard/integracao-egestor/${row.id}/corrigir`} className="btn btn-ghost btn-sm">
                    Corrigir
                  </Link>
                )}
                {(row.status === "so_matriz" || row.status === "so_filial") && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => handleCompletarLinha(row)}
                  >
                    Completar Matriz ⇄ Filial
                  </button>
                )}
              </td>
            </tr>
          ))}
          {visiveis.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
                {q
                  ? `Nenhum contato encontrado para "${query.trim()}".`
                  : "Nenhum contato encontrado."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
