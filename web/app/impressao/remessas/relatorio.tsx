import type { LinhaRemessa, SituacaoRetorno } from "@/lib/api/fiscal";
import { formatDateTimeBR } from "@/lib/format-date";
import {
  brlOuZero,
  dataBR,
  documentoBR,
  nomeEstab,
  numeroBR,
  operacaoCurta,
  ORDEM_SITUACAO_RETORNO,
  SITUACAO_RETORNO,
} from "@/app/dashboard/fiscal/_relatorios/formato";
import BotaoImprimir from "./botao-imprimir";

// Folha do Controle de remessas pra imprimir (page.tsx busca os dados).
// O resumo é contado das linhas impressas, pra bater com a tabela. A
// coluna Alertas (o texto do sinal da linha na tela) só aparece quando
// alguma linha impressa tem alerta.

const TIPO_NF = { enviada: "Saída", recebida: "Entrada" } as const;

export default function RelatorioRemessas({
  linhas,
  alertas,
  filtrosTexto,
  truncado,
  geradoPor,
}: {
  linhas: LinhaRemessa[];
  // chave da remessa → texto de cada alerta dela
  alertas: Map<string, string[]>;
  filtrosTexto: string[];
  truncado: boolean;
  geradoPor: string;
}) {
  const totalRemessas = somar(linhas, (r) => r.valor);
  const totalRetornado = somar(linhas, (r) => r.valorRetornado);
  const comAlertas = linhas.some((r) => (alertas.get(r.chave)?.length ?? 0) > 0);

  return (
    <div className="impressao">
      <div className="impressao-barra">
        <span>
          Confira abaixo e use o botão para imprimir. Para gerar o PDF, escolha &quot;Salvar como PDF&quot; no destino
          da impressão.
        </span>
        <BotaoImprimir />
      </div>

      <header className="impressao-cabecalho">
        <img src="/logo-gama.svg" alt="Gama Brasil" width={97} height={24} />
        <div>
          <h1>Controle de remessas</h1>
          <p>Remessas que exigem retorno — enviadas pela Gama (saída) e recebidas de terceiros (entrada)</p>
          <p>{filtrosTexto.join(" · ")}</p>
        </div>
        <div className="impressao-gerado">
          Gerado em {formatDateTimeBR(new Date().toISOString())}
          <br />
          por {geradoPor}
        </div>
      </header>

      {truncado && (
        <p className="impressao-aviso">
          O período tem mais remessas do que o relatório comporta de uma vez. Estreite o período para ver o restante.
        </p>
      )}

      <ResumoImpressao linhas={linhas} />

      <table className="impressao-tabela">
        <thead>
          <tr className="grupo">
            <th colSpan={9}>Remessa</th>
            <th colSpan={5} className="inicio-retorno">
              Retorno
            </th>
            <th rowSpan={2}>Situação</th>
            {comAlertas && (
              <th rowSpan={2} className="alertas">
                Alertas
              </th>
            )}
          </tr>
          <tr>
            <th>Data</th>
            <th>NF</th>
            <th>Tipo</th>
            <th>Empresa</th>
            <th>CFOP</th>
            <th>Operação</th>
            <th>Estab.</th>
            <th>Itens</th>
            <th className="num">Valor (R$)</th>
            <th className="inicio-retorno">Data</th>
            <th>NF</th>
            <th>CFOP</th>
            <th>Itens</th>
            <th className="num">Valor (R$)</th>
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr>
              <td colSpan={comAlertas ? 16 : 15} style={{ textAlign: "center" }}>
                Nenhuma remessa com esses filtros.
              </td>
            </tr>
          ) : (
            linhas.map((r) => (
              <tr key={`${r.lado}-${r.id}`}>
                <td className="nowrap">{dataBR(r.dataEmissao)}</td>
                <td>{r.numero ?? "—"}</td>
                <td>{TIPO_NF[r.lado]}</td>
                <td>
                  {r.contraparte ?? "—"}
                  {r.documento && <div className="doc">{documentoBR(r.documento)}</div>}
                </td>
                <td>{r.cfops.join(", ")}</td>
                <td>{operacaoCurta(r.natureza)}</td>
                <td>{nomeEstab(r.estabelecimento)}</td>
                <td>
                  {r.itens.map((i, n) => (
                    <div key={n}>{i}</div>
                  ))}
                </td>
                <td className="num">{numeroBR(r.valor)}</td>
                <td className="inicio-retorno nowrap">
                  {r.retornos.map((x) => (
                    <div key={x.chave}>{dataBR(x.dataEmissao)}</div>
                  ))}
                </td>
                <td>
                  {r.retornos.map((x) => (
                    <div key={x.chave}>{x.numero ?? "—"}</div>
                  ))}
                </td>
                <td>
                  {r.retornos.map((x) => (
                    <div key={x.chave}>{x.cfops.join(", ")}</div>
                  ))}
                </td>
                <td>
                  {r.retornos.map((x) => (
                    <div key={x.chave}>{x.itens.join("; ") || "—"}</div>
                  ))}
                </td>
                <td className="num">
                  {r.retornos.map((x) => (
                    <div key={x.chave}>{numeroBR(x.valor)}</div>
                  ))}
                </td>
                <td className="nowrap">
                  {SITUACAO_RETORNO[r.retorno].rotulo}
                  {r.diasEmAberto !== null && r.retorno !== "retornada" && (
                    <div className="doc">há {r.diasEmAberto} dia(s)</div>
                  )}
                </td>
                {comAlertas && (
                  <td className="alertas">
                    {(alertas.get(r.chave) ?? []).map((texto, n) => (
                      <div key={n}>{texto}</div>
                    ))}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
        {linhas.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={8}>Total ({linhas.length} remessa(s))</td>
              <td className="num">{numeroBR(String(totalRemessas))}</td>
              <td colSpan={4} className="inicio-retorno">
                Total retornado
              </td>
              <td className="num">{numeroBR(String(totalRetornado))}</td>
              <td colSpan={comAlertas ? 2 : 1} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// Quantidade e valor por situação, separados em saída e entrada, com o
// que já voltou e o saldo que falta voltar.
function ResumoImpressao({ linhas }: { linhas: LinhaRemessa[] }) {
  const grupos: { rotulo: string; linhas: LinhaRemessa[] }[] = [
    ...ORDEM_SITUACAO_RETORNO.map((s: SituacaoRetorno) => ({
      rotulo: SITUACAO_RETORNO[s].rotulo,
      linhas: linhas.filter((r) => r.retorno === s),
    })),
    { rotulo: "Total", linhas },
  ];
  const celulas = (lista: LinhaRemessa[]) => (
    <>
      <td className="num">{lista.length}</td>
      <td className="num">{brlOuZero(String(somar(lista, (r) => r.valor)))}</td>
    </>
  );
  return (
    <table className="impressao-resumo">
      <thead>
        <tr>
          <th rowSpan={2}>Situação</th>
          <th colSpan={2}>Saída (a Gama enviou)</th>
          <th colSpan={2}>Entrada (a Gama recebeu)</th>
          <th colSpan={2}>Total</th>
          <th rowSpan={2} className="num">
            Já retornado
          </th>
          <th rowSpan={2} className="num">
            Saldo a retornar
          </th>
        </tr>
        <tr>
          <th className="num">Qtd.</th>
          <th className="num">Valor</th>
          <th className="num">Qtd.</th>
          <th className="num">Valor</th>
          <th className="num">Qtd.</th>
          <th className="num">Valor</th>
        </tr>
      </thead>
      <tbody>
        {grupos.map((g) => {
          const retornado = somar(g.linhas, (r) => r.valorRetornado);
          // por remessa: retorno maior que a remessa não abate o saldo de outra
          const saldo = somar(g.linhas, (r) => String(Math.max(0, Number(r.valor) - Number(r.valorRetornado))));
          return (
            <tr key={g.rotulo} className={g.rotulo === "Total" ? "total" : undefined}>
              <td>{g.rotulo}</td>
              {celulas(g.linhas.filter((r) => r.lado === "enviada"))}
              {celulas(g.linhas.filter((r) => r.lado === "recebida"))}
              {celulas(g.linhas)}
              <td className="num">{brlOuZero(String(retornado))}</td>
              <td className="num">{brlOuZero(String(saldo))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function somar(linhas: LinhaRemessa[], valor: (r: LinhaRemessa) => string): number {
  return linhas.reduce((s, r) => s + Number(valor(r)), 0);
}
