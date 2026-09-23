"use client";

import { useState } from "react";
import { useRefresh } from "../_overlay/refresh";
import { temAcessoAutomatico, type CompanyTeam } from "@/lib/api/company-team";
import type { Membership } from "@/lib/api/types";
import { ROLE_LABELS, ROLE_PILL, memberName } from "../(administracao)/membros/roles";
import { setCompanyTeamAction } from "./actions";

// Aba "Equipe de vendas" da ficha do lead (pedido do usuário,
// 2026-09-21), no mesmo molde da aba Contatos: barra de inclusão em cima,
// lista embaixo com Remover à direita. A primeira versão era uma lista de
// checkboxes com TODOS os membros do workspace e um botão Salvar — o
// usuário rejeitou (ficava gigante e misturava quem já tem acesso pelo
// cargo com quem a lista controla de verdade).
//
// Quem aparece: o responsável pela empresa (fixo, não sai por aqui) e
// quem foi incluído na equipe — inclusive o supervisor, que entra sozinho
// no cadastro do prospect (regra 1). Administrador e proprietário nunca
// aparecem: têm acesso automático a tudo (regra 3).
//
// Incluir/remover gravam na hora (RPC + refresh), sem botão Salvar —
// mesmo motivo do AddContactForm: dentro do drawer, ação que navega faz
// a ficha piscar.
export default function EquipeEditor({
  companyId,
  team,
  memberships,
}: {
  companyId: string;
  team: CompanyTeam;
  memberships: Membership[];
}) {
  const refresh = useRefresh();
  const [escolhido, setEscolhido] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const ativos = memberships.filter(
    (m) => m.status === "active" && !temAcessoAutomatico(m.role),
  );
  const porUserId = new Map(ativos.map((m) => [m.userId, m]));
  const responsavel = team.ownerUserId ? porUserId.get(team.ownerUserId) : undefined;
  const naEquipe = team.userIds
    .map((userId) => porUserId.get(userId))
    .filter((m): m is Membership => m !== undefined);

  const candidatos = ativos.filter(
    (m) => m.userId !== team.ownerUserId && !team.userIds.includes(m.userId),
  );

  // "Supervisor" é etiqueta, não um vínculo à parte: o supervisor do
  // responsável entra na equipe como qualquer outro (ver
  // src/companies/equipe-de-vendas.ts) — aqui só se explica por que ele
  // está na lista sem ninguém ter incluído.
  function papelNaEquipe(m: Membership): string {
    if (responsavel && m.id === responsavel.managerId) {
      return `Supervisor de ${memberName(responsavel)}`;
    }
    return "Incluído na equipe";
  }

  async function gravar(userIds: string[], marcador: string) {
    setBusy(marcador);
    setErro(null);
    const res = await setCompanyTeamAction(companyId, userIds);
    if (!res.ok) {
      setBusy(null);
      setErro(res.message);
      return;
    }
    setEscolhido("");
    // Sem limpar o `busy` no sucesso: a lista vai se redesenhar no
    // refresh, e reabilitar antes disso só daria margem pra um segundo
    // clique no mesmo membro (mesmo cuidado do ContactItem#handleRemove).
    refresh();
  }

  function incluir(event: React.FormEvent) {
    event.preventDefault();
    if (!escolhido || busy) return;
    void gravar([...team.userIds, escolhido], "incluir");
  }

  // A equipe nunca pode ficar vazia (regra do usuário, 2026-09-21) — o
  // backend recusa, aqui só evita oferecer o botão que vai dar erro.
  // Com responsável definido nunca é o caso: ele conta como membro e não
  // sai por esta aba.
  const ultimoDaEquipe = !responsavel && naEquipe.length <= 1;

  function remover(m: Membership) {
    if (busy) return;
    if (!window.confirm(`Tirar ${memberName(m)} da equipe de vendas desta empresa?`)) return;
    void gravar(
      team.userIds.filter((userId) => userId !== m.userId),
      m.userId,
    );
  }

  function linha(m: Membership, sub: string, acao?: React.ReactNode) {
    return (
      <div key={m.userId} className="drawer-list-item">
        <div>
          <div className="dli-title">{memberName(m)}</div>
          <div className="dli-sub">{sub}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={ROLE_PILL[m.role]}>{ROLE_LABELS[m.role]}</span>
          {acao}
        </div>
      </div>
    );
  }

  return (
    <>
      {team.podeEditar && (
        <form onSubmit={incluir} className="form-grid" style={{ marginBottom: 20 }}>
          {erro && <div className="error-banner">{erro}</div>}
          <label>
            Incluir na equipe
            <select
              value={escolhido}
              onChange={(event) => setEscolhido(event.target.value)}
              disabled={busy !== null || candidatos.length === 0}
            >
              <option value="">
                {candidatos.length === 0 ? "Todos já estão na equipe" : "Selecione o membro…"}
              </option>
              {candidatos.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {memberName(m)} — {ROLE_LABELS[m.role]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy !== null || !escolhido}
          >
            {busy === "incluir" ? "Incluindo…" : "Adicionar à equipe"}
          </button>
        </form>
      )}

      {!team.podeEditar && erro && <div className="error-banner">{erro}</div>}

      {responsavel
        ? linha(responsavel, "Responsável pela empresa")
        : team.ownerUserId && (
            <div className="drawer-list-item">
              <div>
                <div className="dli-title">Responsável não encontrado</div>
                <div className="dli-sub">O membro dono desta empresa não está mais ativo.</div>
              </div>
            </div>
          )}

      {naEquipe.map((m) =>
        linha(
          m,
          papelNaEquipe(m),
          team.podeEditar ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== null || ultimoDaEquipe}
              title={
                ultimoDaEquipe
                  ? "A equipe precisa de pelo menos um membro — inclua outro antes de remover este."
                  : undefined
              }
              onClick={() => remover(m)}
            >
              {busy === m.userId ? "Removendo…" : "Remover"}
            </button>
          ) : undefined,
        ),
      )}

      {!responsavel && naEquipe.length === 0 && (
        <p className="empty">Ninguém na equipe de vendas desta empresa ainda.</p>
      )}

      <p className="t-sub" style={{ marginTop: 14 }}>
        Quem está na equipe enxerga esta empresa e o lead dela na Prospecção. Administrador e
        proprietário já enxergam tudo e por isso não entram na lista.
        {!team.podeEditar && " Só gerente ou administrador muda a equipe."}
      </p>
    </>
  );
}
