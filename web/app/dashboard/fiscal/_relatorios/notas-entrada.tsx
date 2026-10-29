import { getEntradas } from "@/lib/api/fiscal";
import { faixaDoPeriodo, PERIODOS } from "../../relatorios/periodo";
import { PAGINA } from "./formato";
import PainelEntradas from "./painel-entradas";
import PersonalizadoAoDigitar from "../../relatorios/personalizado-ao-digitar";

// Notas de entrada (pedido do usuário, 2026-10-26; docs/console-fiscal.md,
// decisão 7.8): as NF-e que a Gama recebeu e as de entrada que ela mesma
// emite, com a classificação de cada item — no eGestor essas notas não são
// lançadas, ou são lançadas só em parte. O período vem da querystring; o
// resto dos filtros (busca, operação, eGestor, classificação) vive no
// painel e responde na hora.

const PERIODO_PADRAO = "mes";

export default async function NotasEntrada({
  token,
  params,
  podeEditar,
}: {
  token: string;
  params: Record<string, string | undefined>;
  podeEditar: boolean;
}) {
  const periodo = PERIODOS.some((p) => p.valor === params.periodo) ? (params.periodo as string) : PERIODO_PADRAO;
  const faixa = faixaDoPeriodo(periodo, { inicio: params.inicio, fim: params.fim });
  const estabelecimento =
    params.estabelecimento === "matriz" || params.estabelecimento === "filial" ? params.estabelecimento : "";
  const dados = await getEntradas(token, {
    inicio: faixa.inicio,
    fim: faixa.fim,
    estabelecimento: estabelecimento || undefined,
  });

  return (
    <>
      <div className="panel filtros-painel">
        <div className="panel-body">
          <form method="get" action={PAGINA} className="rel-filtros filtros-linha" aria-label="Filtros">
            <PersonalizadoAoDigitar />
            <input type="hidden" name="r" value="entradas" />

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

            <div className="rel-filtros-acoes">
              <button type="submit" className="btn btn-primary">
                Gerar relatório
              </button>
            </div>
          </form>
        </div>
      </div>

      {dados.truncado && (
        <p className="field-hint" style={{ marginBottom: 12 }}>
          O período tem mais notas do que a lista mostra de uma vez. Estreite o filtro para ver o restante.
        </p>
      )}

      <PainelEntradas
        key={`${dados.inicio}-${dados.fim}-${estabelecimento}`}
        rows={dados.rows}
        historico={dados.historico}
        podeEditar={podeEditar}
      />
    </>
  );
}
