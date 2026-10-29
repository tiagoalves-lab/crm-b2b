import { companyRazaoSocialName } from "@/lib/api/companies";
import { taskTypeLabel, TASK_TYPE_LABELS } from "@/lib/api/tasks";
import { gerarRelatorioTarefasConcluidas } from "@/lib/api/relatorios";
import type { Membership, TaskType } from "@/lib/api/types";
import { formatDateOnlyBR, formatDateTimeBR } from "@/lib/format-date";
import { memberName } from "../../(administracao)/membros/roles";
import { faixaDoPeriodo, faixaPorExtenso, PERIODOS, PERIODO_PADRAO } from "../periodo";
import PersonalizadoAoDigitar from "../personalizado-ao-digitar";

// Relatório "Tarefas concluídas" (pedido do usuário, 2026-09-23) — mesma
// moldura do relatório de anotações: filtros em cima, resultado embaixo.
// A data que manda aqui é a da CONCLUSÃO, não a do prazo.
export default async function RelatorioTarefasConcluidas({
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
  const tipo = params.tipo ?? "";
  const usuarioId = params.usuarioId ?? "";
  const empresa = params.empresa ?? "";
  const gerou = params.gerar === "1";

  const ativos = memberships.filter((m) => m.status === "active");
  const nomeDe = (userId: string) => {
    const membro = memberships.find((m) => m.userId === userId);
    return membro ? memberName(membro) : "—";
  };

  const relatorio = gerou
    ? await gerarRelatorioTarefasConcluidas(token, {
        inicio: faixa.inicio,
        fim: faixa.fim,
        tipo: tipo || undefined,
        usuarioId: usuarioId || undefined,
        empresa: empresa.trim() || undefined,
      })
    : null;

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Filtros</div>
        </div>
        <div className="panel-body">
          <form method="get" action="/dashboard/relatorios" className="rel-filtros">
            <PersonalizadoAoDigitar />
            <input type="hidden" name="r" value="tarefas-concluidas" />

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
              <label htmlFor="tipo">Tipo de tarefa</label>
              <select id="tipo" name="tipo" defaultValue={tipo}>
                <option value="">Todos os tipos</option>
                {Object.entries(TASK_TYPE_LABELS).map(([valor, label]) => (
                  <option key={valor} value={valor}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="usuarioId">Responsável</label>
              <select id="usuarioId" name="usuarioId" defaultValue={usuarioId}>
                <option value="">Todos os responsáveis</option>
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
            <div className="panel-title">Tarefas concluídas</div>
            <div className="sub">
              {faixaPorExtenso(faixa)} · {relatorio.total} tarefa(s)
            </div>
          </div>
          <div className="panel-body">
            {relatorio.truncado && (
              <p className="field-hint" style={{ marginBottom: 12 }}>
                O período tem mais tarefas do que o relatório mostra de uma vez. Estreite o filtro
                para ver o restante.
              </p>
            )}
            {relatorio.rows.length === 0 ? (
              <p className="sub">Nenhuma tarefa concluída com esses filtros.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Concluída em</th>
                    <th>Empresa</th>
                    <th>Responsável</th>
                    <th>Tipo</th>
                    <th>Tarefa</th>
                    <th>Prazo</th>
                  </tr>
                </thead>
                <tbody>
                  {relatorio.rows.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatDateTimeBR(t.concluidaEm)}</td>
                      <td>{t.company ? companyRazaoSocialName(t.company) : "—"}</td>
                      <td>{nomeDe(t.assigneeUserId)}</td>
                      <td>{taskTypeLabel((t.tipo as TaskType | null) ?? null)}</td>
                      <td>
                        <div>{t.titulo}</div>
                        {t.descricao && <div className="t-sub">{t.descricao}</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {t.dueAt ? formatDateOnlyBR(t.dueAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
