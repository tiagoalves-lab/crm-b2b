import { companyRazaoSocialName } from "@/lib/api/companies";
import { gerarRelatorioAnotacoes, type AnotacaoRelatorioRow } from "@/lib/api/relatorios";
import type { Membership } from "@/lib/api/types";
import { formatDateBR, formatDateTimeBR } from "@/lib/format-date";
import { memberName } from "../../(administracao)/membros/roles";
import { faixaDoPeriodo, faixaPorExtenso, PERIODOS, PERIODO_PADRAO } from "../periodo";

// Rótulo e cor por tipo de registro — mesmas chaves da Timeline da ficha
// (AddNoteForm/ficha-body.tsx), pra "Ligação" aqui ser a mesma "Ligação"
// de lá.
const SUBTIPO_LABEL: Record<string, string> = {
  nota: "Anotação",
  ligacao: "Ligação",
  reuniao: "Reunião",
  visita: "Visita",
  email: "E-mail",
  posvenda: "Pós-venda",
};

const SUBTIPO_COLOR: Record<string, string> = {
  nota: "purple",
  ligacao: "blue",
  reuniao: "green",
  visita: "amber",
  email: "red",
  posvenda: "gray",
};

// Uma linha da tabela: um registro, ou vários do MESMO tipo na MESMA
// empresa pelo MESMO usuário mesclados (pedido do usuário, 2026-09-23 —
// "pode mesclar na mesma linha"). O usuário entra na chave porque ele é
// uma das colunas: juntar anotações de duas pessoas na mesma linha
// deixaria a coluna sem resposta.
interface Linha {
  chave: string;
  empresa: string;
  empresaId: string | null;
  usuario: string;
  subtipo: string;
  registros: AnotacaoRelatorioRow[];
}

function agrupar(rows: AnotacaoRelatorioRow[], nomeDe: (userId: string | null) => string, mesclar: boolean): Linha[] {
  const linhas = new Map<string, Linha>();
  for (const row of rows) {
    const empresa = row.company ? companyRazaoSocialName(row.company) : "— sem empresa —";
    const chave = mesclar
      ? `${row.company?.id ?? "sem"}|${row.subtipo}|${row.actorUserId ?? "sem"}`
      : row.id;
    const atual = linhas.get(chave);
    if (atual) {
      atual.registros.push(row);
      continue;
    }
    linhas.set(chave, {
      chave,
      empresa,
      empresaId: row.company?.id ?? null,
      usuario: nomeDe(row.actorUserId),
      subtipo: row.subtipo,
      registros: [row],
    });
  }
  // Mais recente primeiro — dentro da linha mesclada também.
  const lista = [...linhas.values()];
  for (const linha of lista) {
    linha.registros.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  return lista.sort((a, b) => b.registros[0].occurredAt.localeCompare(a.registros[0].occurredAt));
}

export default async function RelatorioAnotacoes({
  token,
  params,
  memberships,
}: {
  token: string;
  params: Record<string, string | undefined>;
  memberships: Membership[];
}) {
  const periodo = PERIODOS.some((p) => p.valor === params.periodo)
    ? (params.periodo as string)
    : PERIODO_PADRAO;
  const faixa = faixaDoPeriodo(periodo, { inicio: params.inicio, fim: params.fim });
  const subtipo = params.subtipo ?? "";
  const usuarioId = params.usuarioId ?? "";
  const empresa = params.empresa ?? "";
  const mesclar = params.mesclar !== "nao";
  const gerou = params.gerar === "1";

  const ativos = memberships.filter((m) => m.status === "active");
  const nomeDe = (userId: string | null) => {
    if (!userId) return "Sistema";
    const membro = ativos.find((m) => m.userId === userId) ?? memberships.find((m) => m.userId === userId);
    return membro ? memberName(membro) : "—";
  };

  const relatorio = gerou
    ? await gerarRelatorioAnotacoes(token, {
        inicio: faixa.inicio,
        fim: faixa.fim,
        subtipo: subtipo || undefined,
        usuarioId: usuarioId || undefined,
        empresa: empresa.trim() || undefined,
      })
    : null;

  const linhas = relatorio ? agrupar(relatorio.rows, nomeDe, mesclar) : [];

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Filtros</div>
        </div>
        <div className="panel-body">
          <form method="get" action="/dashboard/relatorios" className="rel-filtros">
            <input type="hidden" name="r" value="anotacoes" />

            <div className="field">
              <label htmlFor="periodo">Data rápida</label>
              <select id="periodo" name="periodo" defaultValue={periodo}>
                {PERIODOS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="inicio">Data inicial</label>
              <input id="inicio" type="date" name="inicio" defaultValue={faixa.inicio} />
              <div className="field-hint">Vale quando a data rápida é &quot;Personalizado&quot;.</div>
            </div>

            <div className="field">
              <label htmlFor="fim">Data final</label>
              <input id="fim" type="date" name="fim" defaultValue={faixa.fim} />
            </div>

            <div className="field">
              <label htmlFor="subtipo">Tipo de anotação</label>
              <select id="subtipo" name="subtipo" defaultValue={subtipo}>
                <option value="">Todos os tipos</option>
                {Object.entries(SUBTIPO_LABEL).map(([valor, label]) => (
                  <option key={valor} value={valor}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="usuarioId">Usuário</label>
              <select id="usuarioId" name="usuarioId" defaultValue={usuarioId}>
                <option value="">Todos os usuários</option>
                {ativos.map((m) => (
                  <option key={m.id} value={m.userId}>
                    {memberName(m)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="empresa">Empresa</label>
              <input
                id="empresa"
                type="text"
                name="empresa"
                defaultValue={empresa}
                placeholder="parte do nome da empresa"
                maxLength={120}
              />
            </div>

            <div className="field">
              <label htmlFor="mesclar">Mesclar registros do mesmo tipo</label>
              <select id="mesclar" name="mesclar" defaultValue={mesclar ? "sim" : "nao"}>
                <option value="sim">Sim — uma linha por empresa e tipo</option>
                <option value="nao">Não — uma linha por registro</option>
              </select>
            </div>

            <div className="rel-filtros-acoes">
              <button type="submit" name="gerar" value="1" className="btn btn-primary">
                Gerar relatório
              </button>
            </div>
          </form>
        </div>
      </div>

      {relatorio && (
        <div className="panel rel-resultado">
          <div className="panel-head">
            <div className="panel-title">Anotações da Timeline</div>
            <div className="sub">
              {faixaPorExtenso(faixa)} · {relatorio.total} registro(s)
              {mesclar && linhas.length !== relatorio.total ? ` em ${linhas.length} linha(s)` : ""}
            </div>
          </div>
          <div className="panel-body">
            {relatorio.truncado && (
              <p className="field-hint" style={{ marginBottom: 12 }}>
                O período tem mais registros do que o relatório mostra de uma vez. Estreite o
                filtro para ver o restante.
              </p>
            )}
            {linhas.length === 0 ? (
              <p className="sub">Nenhuma anotação registrada com esses filtros.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Usuário</th>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha) => {
                    const cor = SUBTIPO_COLOR[linha.subtipo] ?? "gray";
                    const varios = linha.registros.length > 1;
                    return (
                      <tr key={linha.chave}>
                        <td>{linha.empresa}</td>
                        <td>{linha.usuario}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {formatDateBR(linha.registros[0].occurredAt)}
                          {varios && (
                            <div className="t-sub">
                              {linha.registros.length} registros · desde{" "}
                              {formatDateBR(linha.registros[linha.registros.length - 1].occurredAt)}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`pill pill-${cor}`}>
                            {SUBTIPO_LABEL[linha.subtipo] ?? linha.subtipo}
                          </span>
                        </td>
                        <td>
                          {linha.registros.map((r) => (
                            <div key={r.id} className="rel-anotacao">
                              {varios && (
                                <span className="rel-anotacao-data">
                                  {formatDateTimeBR(r.occurredAt)}
                                </span>
                              )}
                              <span>{r.texto || "—"}</span>
                              {r.contatoNome && (
                                <span className="rel-anotacao-contato">· {r.contatoNome}</span>
                              )}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
