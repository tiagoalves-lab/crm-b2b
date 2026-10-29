import { getRelatorioReceita, type TotalReceita } from "@/lib/api/fiscal";
import { faixaDoPeriodo, faixaPorExtenso, PERIODOS } from "../../relatorios/periodo";
import { brlOuZero, dataBR, nomeEstab, NUM, PAGINA, Situacao } from "./formato";
import PersonalizadoAoDigitar from "../../relatorios/personalizado-ao-digitar";

// Relatório "Resumo de notas emitidas" (pedido do usuário, 2026-10-21, no
// molde do "Resumo NFe" do eGestor): NF-e com CFOP marcado Receita junto
// com as NFS-e, que é a base do PIS e da COFINS. O filtro "Notas" troca
// pra todas as emitidas, pra fechar com a lista do eGestor (2026-10-27). Mesma moldura da tela de
// Relatórios — filtros em cima num formulário GET comum, resultado
// embaixo. Gera direto ao abrir: um mês tem poucas dezenas de notas.

// Apuração é do mês fechado.
const PERIODO_PADRAO = "mes-anterior";

const TIPO_ROTULO = { produto: "Produto", servico: "Serviço" } as const;

const COLUNAS = 13;

export default async function RelatorioNotasReceita({
  token,
  params,
}: {
  token: string;
  params: Record<string, string | undefined>;
}) {
  const periodo = PERIODOS.some((p) => p.valor === params.periodo)
    ? (params.periodo as string)
    : PERIODO_PADRAO;
  const faixa = faixaDoPeriodo(periodo, { inicio: params.inicio, fim: params.fim });
  const estabelecimento =
    params.estabelecimento === "matriz" || params.estabelecimento === "filial" ? params.estabelecimento : "";
  const tipo = params.tipo === "produto" || params.tipo === "servico" ? params.tipo : "";
  const situacao = params.situacao === "autorizada" || params.situacao === "cancelada" ? params.situacao : "";
  const notas = params.notas === "todas" ? "todas" : "";
  // Filtro por natureza da operação (pedido do usuário, 2026-10-26).
  const operacao = (params.operacao ?? "").trim();

  const relatorio = await getRelatorioReceita(token, {
    inicio: faixa.inicio,
    fim: faixa.fim,
    estabelecimento: estabelecimento || undefined,
    tipo: tipo || undefined,
    situacao: situacao || undefined,
    notas: notas || undefined,
    operacao: operacao || undefined,
  });

  // A escolhida continua na lista mesmo se o período novo não tiver nota dela.
  const operacoes =
    operacao && !relatorio.operacoes.includes(operacao) ? [operacao, ...relatorio.operacoes] : relatorio.operacoes;

  // Com um tipo só no filtro, a linha do tipo repete a do total geral.
  const totais = relatorio.totais.filter((t) => t.tipo === null || !tipo);

  return (
    <>
      <div className="panel filtros-painel">
        <div className="panel-body">
          <form method="get" action={PAGINA} className="rel-filtros filtros-linha" aria-label="Filtros">
            <PersonalizadoAoDigitar />
            <input type="hidden" name="r" value="receita" />

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
              <input
                id="inicio"
                type="date"
                name="inicio"
                defaultValue={faixa.inicio}
                title='Vale quando a data rápida é "Personalizado"'
              />
            </div>

            <div className="field">
              <label htmlFor="fim">Data final</label>
              <input id="fim" type="date" name="fim" defaultValue={faixa.fim} />
            </div>

            <div className="field">
              <label htmlFor="estabelecimento">Estabelecimento</label>
              <select id="estabelecimento" name="estabelecimento" defaultValue={estabelecimento}>
                <option value="">Matriz e Filial</option>
                <option value="matriz">Matriz</option>
                <option value="filial">Filial</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="tipo">Tipo</label>
              <select id="tipo" name="tipo" defaultValue={tipo}>
                <option value="">Produto e serviço</option>
                <option value="produto">Produto (NF-e)</option>
                <option value="servico">Serviço (NFS-e)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="situacao">Situação</label>
              <select id="situacao" name="situacao" defaultValue={situacao}>
                <option value="">Autorizadas e canceladas</option>
                <option value="autorizada">Autorizadas</option>
                <option value="cancelada">Canceladas</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="notas">Notas</label>
              <select id="notas" name="notas" defaultValue={notas}>
                <option value="">Só receita</option>
                <option value="todas">Todas as emitidas</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="operacao">Operação</label>
              <select id="operacao" name="operacao" defaultValue={operacao}>
                <option value="">Todas</option>
                {operacoes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>

            <div className="rel-filtros-acoes">
              <button type="submit" className="btn btn-primary">
                Gerar relatório
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="panel rel-resultado">
        <div className="panel-head">
          <div className="panel-title">Resumo de notas emitidas</div>
          <div className="sub">
            {faixaPorExtenso({ inicio: relatorio.inicio, fim: relatorio.fim })} · {relatorio.rows.length} nota(s)
          </div>
        </div>
        <div className="panel-body">
          {relatorio.truncado && (
            <p className="field-hint" style={{ marginBottom: 12 }}>
              O período tem mais notas do que a lista mostra de uma vez. Os totais valem para o período
              inteiro; estreite o filtro para ver o restante das notas.
            </p>
          )}
          <div className="fiscal-tabela">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nº nota</th>
                  <th>Estab.</th>
                  <th>Tipo</th>
                  <th>Operação</th>
                  <th>Destinatário</th>
                  <th>Data emissão</th>
                  <th>Situação</th>
                  <th style={NUM}>Total</th>
                  <th style={NUM}>ICMS</th>
                  <th style={NUM}>IPI</th>
                  <th style={NUM}>ISS</th>
                  <th style={NUM}>PIS</th>
                  <th style={NUM}>COFINS</th>
                </tr>
              </thead>
              <tbody>
                {relatorio.rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUNAS} className="t-sub" style={{ textAlign: "center" }}>
                      {notas ? "Nenhuma nota com esses filtros." : "Nenhuma nota de receita com esses filtros."}
                    </td>
                  </tr>
                ) : (
                  relatorio.rows.map((n) => (
                    <tr key={`${n.tipo}-${n.id}`}>
                      <td>{n.numero ?? "—"}</td>
                      <td>{nomeEstab(n.estabelecimento)}</td>
                      <td>{TIPO_ROTULO[n.tipo]}</td>
                      <td>{n.operacao ?? "—"}</td>
                      <td>
                        {n.destinatario ?? "—"}{" "}
                        {n.cfopMisto && (
                          <span
                            className="pill pill-amber"
                            title="A nota tem item de receita e item de outro CFOP — o total da nota passa da receita"
                          >
                            CFOP misto
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{dataBR(n.dataEmissao)}</td>
                      <td>
                        <Situacao valor={n.situacao} />
                      </td>
                      <td style={NUM}>{brlOuZero(n.total)}</td>
                      <td style={NUM}>{brlOuZero(n.vIcms)}</td>
                      <td style={NUM}>{brlOuZero(n.vIpi)}</td>
                      <td style={NUM}>{brlOuZero(n.vIss)}</td>
                      <td style={NUM}>{brlOuZero(n.vPis)}</td>
                      <td style={NUM}>{brlOuZero(n.vCofins)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {totais.length > 0 && (
                <tfoot>
                  {totais.map((t) => (
                    <LinhaTotal key={t.tipo ?? "geral"} total={t} />
                  ))}
                </tfoot>
              )}
            </table>
          </div>
          {situacao === "" && (
            <p className="field-hint" style={{ marginTop: 10 }}>
              Notas canceladas aparecem na lista, mas não entram nos totais.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function LinhaTotal({ total }: { total: TotalReceita }) {
  const rotulo = total.tipo === "produto" ? "Produtos" : total.tipo === "servico" ? "Serviços" : "Total";
  return (
    <tr>
      <td colSpan={7}>
        {rotulo} · {total.notas} nota(s)
      </td>
      <td style={NUM}>{brlOuZero(total.total)}</td>
      <td style={NUM}>{brlOuZero(total.vIcms)}</td>
      <td style={NUM}>{brlOuZero(total.vIpi)}</td>
      <td style={NUM}>{brlOuZero(total.vIss)}</td>
      <td style={NUM}>{brlOuZero(total.vPis)}</td>
      <td style={NUM}>{brlOuZero(total.vCofins)}</td>
    </tr>
  );
}
