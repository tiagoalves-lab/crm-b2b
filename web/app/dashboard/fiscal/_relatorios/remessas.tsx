import { getRemessas, type ResumoRemessas, type SituacaoRetorno } from "@/lib/api/fiscal";
import { dayKeyBR } from "@/lib/format-date";
import { faixaDoPeriodo, faixaPorExtenso, PERIODOS } from "../../relatorios/periodo";
import { brlOuZero, ORDEM_SITUACAO_RETORNO, PAGINA, SITUACAO_RETORNO } from "./formato";
import PersonalizadoAoDigitar from "../../relatorios/personalizado-ao-digitar";
import PainelRemessas from "./painel-remessas";

// Controle de remessas (pedido do usuário, 2026-10-21 e 2026-10-22;
// docs/console-fiscal.md, decisões 7.4 e 7.5): remessa que exige retorno,
// nos dois sentidos — a que a Gama mandou e tem que voltar, e a que a Gama
// recebeu e tem que devolver —, no formato da planilha do usuário: a
// remessa à esquerda, o retorno ao lado, e as notas de retorno numa coluna
// à direita pra arrastar até a linha. Filtros em cima, por querystring.

// A tela abre nos últimos 12 meses (pedido do usuário, 2026-10-28); "Desde
// o início" cobre a base inteira, que tem todo o histórico do eGestor
// desde a carga de 2026-10-28.
const ULTIMOS_12_MESES = { valor: "12m", label: "Últimos 12 meses" };
const DESDE_O_INICIO = { valor: "tudo", label: "Desde o início" };
const INICIO_DA_BASE = "2000-01-01";

function faixaDaTela(periodo: string, personalizado: { inicio?: string; fim?: string }) {
  const hoje = dayKeyBR(new Date());
  if (periodo === DESDE_O_INICIO.valor) return { inicio: INICIO_DA_BASE, fim: hoje };
  if (periodo === ULTIMOS_12_MESES.valor) {
    const [ano, resto] = [Number(hoje.slice(0, 4)), hoje.slice(4)];
    return { inicio: `${ano - 1}${resto === "-02-29" ? "-03-01" : resto}`, fim: hoje };
  }
  return faixaDoPeriodo(periodo, personalizado);
}
// Todas: a linha fica na tela e vai se preenchendo conforme se arrasta o
// retorno (com "pendentes", ela sumiria ao ser fechada).
const RETORNO_PADRAO = "todas";

// Filtros da querystring — os mesmos na tela e na versão de impressão
// (/impressao/remessas), pra impressão sair igual ao que está na tela.
export function lerFiltrosRemessas(params: Record<string, string | undefined>) {
  const periodo =
    params.periodo === ULTIMOS_12_MESES.valor ||
    params.periodo === DESDE_O_INICIO.valor ||
    PERIODOS.some((p) => p.valor === params.periodo)
      ? (params.periodo as string)
      : ULTIMOS_12_MESES.valor;
  const faixa = faixaDaTela(periodo, { inicio: params.inicio, fim: params.fim });
  const estabelecimento =
    params.estabelecimento === "matriz" || params.estabelecimento === "filial" ? params.estabelecimento : "";
  const lado = params.lado === "enviada" || params.lado === "recebida" ? params.lado : "";
  const retorno =
    params.retorno === "pendente" || params.retorno === "retornada" || params.retorno === "todas"
      ? params.retorno
      : RETORNO_PADRAO;
  return { periodo, faixa, estabelecimento, lado, retorno };
}

export function buscarRemessas(token: string, filtros: ReturnType<typeof lerFiltrosRemessas>) {
  return getRemessas(token, {
    inicio: filtros.faixa.inicio,
    fim: filtros.faixa.fim,
    estabelecimento: filtros.estabelecimento || undefined,
    lado: filtros.lado || undefined,
    retorno: filtros.retorno === "todas" ? undefined : filtros.retorno,
  });
}

export default async function ControleRemessas({
  token,
  params,
  podeEditar,
}: {
  token: string;
  params: Record<string, string | undefined>;
  podeEditar: boolean;
}) {
  const filtros = lerFiltrosRemessas(params);
  const { periodo, faixa, estabelecimento, lado, retorno } = filtros;
  const controle = await buscarRemessas(token, filtros);

  // Versão pra imprimir/salvar em PDF e mandar pra contabilidade (pedido
  // do usuário, 2026-10-26): os mesmos filtros; o painel acrescenta os de
  // empresa e item, que vivem só na tela.
  const impressao = new URLSearchParams({ periodo, inicio: faixa.inicio, fim: faixa.fim, retorno });
  if (estabelecimento) impressao.set("estabelecimento", estabelecimento);
  if (lado) impressao.set("lado", lado);

  return (
    <>
      <CardsResumo resumo={controle.resumo} />

      <div className="panel filtros-painel">
        <div className="panel-body">
          <form method="get" action={PAGINA} className="rel-filtros filtros-linha" aria-label="Filtros">
            <PersonalizadoAoDigitar />
            <input type="hidden" name="r" value="remessas" />

            <div className="field">
              <label htmlFor="periodo">Data rápida</label>
              <select id="periodo" name="periodo" defaultValue={periodo}>
                <option value={ULTIMOS_12_MESES.valor}>{ULTIMOS_12_MESES.label}</option>
                <option value={DESDE_O_INICIO.valor}>{DESDE_O_INICIO.label}</option>
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
              <label htmlFor="lado">Remessa</label>
              <select id="lado" name="lado" defaultValue={lado}>
                <option value="">Saída e entrada</option>
                <option value="enviada">Saída (a Gama enviou)</option>
                <option value="recebida">Entrada (a Gama recebeu)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="retorno">Retorno</label>
              <select id="retorno" name="retorno" defaultValue={retorno}>
                <option value="todas">Todas</option>
                <option value="pendente">Pendentes</option>
                <option value="retornada">Retornadas</option>
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

      {controle.truncado && (
        <p className="field-hint" style={{ marginBottom: 12 }}>
          O período tem mais remessas do que a lista mostra de uma vez. Estreite o filtro para ver o restante.
        </p>
      )}

      <PainelRemessas
        key={`${controle.inicio}-${controle.fim}-${estabelecimento}-${lado}-${retorno}`}
        rows={controle.rows}
        retornos={controle.retornos}
        alertasLog={controle.alertasLog}
        podeEditar={podeEditar}
        linkImpressao={`/impressao/remessas?${impressao.toString()}`}
      />
    </>
  );
}

// Resumo do período em cards no topo (pedido do usuário, 2026-10-22): o
// total e cada situação do retorno, com a divisão entre remessa de saída
// (a Gama enviou) e de entrada (a Gama recebeu). Vale o período e os
// filtros de estabelecimento e de remessa — o de retorno não muda os cards.
function CardsResumo({ resumo }: { resumo: ResumoRemessas[] }) {
  const somar = (linhas: ResumoRemessas[]) => ({
    remessas: linhas.reduce((s, x) => s + x.remessas, 0),
    valor: linhas.reduce((s, x) => s + Number(x.valor), 0),
    saida: linhas.filter((x) => x.lado === "enviada").reduce((s, x) => s + x.remessas, 0),
    entrada: linhas.filter((x) => x.lado === "recebida").reduce((s, x) => s + x.remessas, 0),
  });
  const cards: { chave: string; rotulo: string; cor: string; ajuda?: string; dados: ReturnType<typeof somar> }[] = [
    { chave: "total", rotulo: "Remessas no período", cor: "stat-tile purple", dados: somar(resumo) },
    ...ORDEM_SITUACAO_RETORNO.map((situacao: SituacaoRetorno) => ({
      chave: situacao,
      rotulo: SITUACAO_RETORNO[situacao].rotulo,
      cor: COR_CARD[situacao],
      ajuda: SITUACAO_RETORNO[situacao].ajuda,
      dados: somar(resumo.filter((x) => x.retorno === situacao)),
    })),
  ];
  return (
    <div className="stat-grid stat-grid-compacto">
      {cards.map((c) => (
        <div key={c.chave} className={c.cor} title={c.ajuda}>
          <div className="stat-label">{c.rotulo}</div>
          <div className="stat-value">{c.dados.remessas}</div>
          <div className="sub">{brlOuZero(String(c.dados.valor))}</div>
          <div className="sub">
            Saída {c.dados.saida} · Entrada {c.dados.entrada}
          </div>
        </div>
      ))}
    </div>
  );
}

const COR_CARD: Record<SituacaoRetorno, string> = {
  aberta: "stat-tile danger",
  parcial: "stat-tile",
  retornada: "stat-tile green",
};
