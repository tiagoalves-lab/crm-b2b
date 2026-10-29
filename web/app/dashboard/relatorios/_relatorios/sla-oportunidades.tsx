import Link from "next/link";
import { companyRazaoSocialName } from "@/lib/api/companies";
import { gerarRelatorioSlaOportunidades } from "@/lib/api/relatorios";
import type { SlaFaixa, SlaResumo } from "@/lib/api/relatorios";
import type { Membership } from "@/lib/api/types";
import { memberName } from "../../(administracao)/membros/roles";
import { faixaDoPeriodo, faixaPorExtenso, PERIODOS } from "../periodo";
import PersonalizadoAoDigitar from "../personalizado-ao-digitar";

// Relatório "SLA de Oportunidades" (pedido do usuário, 2026-10-28):
// histograma de quantas propostas levaram cada número de dias úteis de SLA
// e, embaixo, a lista das oportunidades da mais lenta para a mais rápida.
// O SLA é o mesmo do selo do card do Pipeline (pipeline/sla.ts); a conta
// é feita no backend (src/relatorios/sla-oportunidades-relatorio.service.ts).
//
// O período filtra pela ABERTURA da oportunidade. Padrão "Este ano": o SLA
// automático começou em setembro/2026 e 30 dias mostrariam pouca coisa.
const PERIODO_PADRAO_SLA = "ano";

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  won: "Ganha",
  lost: "Perdida",
};

const diaBR = (dia: string) => dia.split("-").reverse().join("/");
const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const diasUteis = (d: number) => (d === 1 ? "1 dia útil" : `${numero(d)} dias úteis`);

export default async function RelatorioSlaOportunidades({
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
    : PERIODO_PADRAO_SLA;
  const faixa = faixaDoPeriodo(periodo, { inicio: params.inicio, fim: params.fim });
  const usuarioId = params.usuarioId ?? "";
  const gerou = params.gerar === "1";

  const ativos = memberships.filter((m) => m.status === "active");
  const nomeDe = (userId: string) => {
    const membro = memberships.find((m) => m.userId === userId);
    return membro ? memberName(membro) : "—";
  };

  const relatorio = gerou
    ? await gerarRelatorioSlaOportunidades(token, {
        inicio: faixa.inicio,
        fim: faixa.fim,
        usuarioId: usuarioId || undefined,
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
            <input type="hidden" name="r" value="sla-oportunidades" />

            <div className="field">
              <label htmlFor="periodo">Abertura da oportunidade</label>
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
              <div className="field-hint">Vale quando o período é &quot;Personalizado&quot;.</div>
            </div>

            <div className="field">
              <label htmlFor="fim">Data final</label>
              <input id="fim" type="date" name="fim" defaultValue={faixa.fim} />
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

            <div className="rel-filtros-acoes">
              <button type="submit" name="gerar" value="1" className="btn btn-primary">
                Gerar relatório
              </button>
            </div>
          </form>
        </div>
      </div>

      {relatorio && (
        <>
          {relatorio.resumo.total === 0 ? (
            <div className="panel rel-resultado">
              <div className="panel-body">
                <p className="sub">Nenhuma oportunidade aberta nesse período com esses filtros.</p>
              </div>
            </div>
          ) : (
            <>
              <Resumo resumo={relatorio.resumo} />

              <div className="panel rel-resultado">
                <div className="panel-head">
                  <div className="panel-title">Propostas por dias úteis de SLA</div>
                  <div className="sub">
                    Abertas de {faixaPorExtenso(faixa)} · {relatorio.resumo.total} oportunidade(s)
                  </div>
                </div>
                <div className="panel-body">
                  <Histograma faixas={relatorio.faixas} resumo={relatorio.resumo} />
                  <p className="field-hint sla-nota">
                    Dias úteis (segunda a sexta, sem descontar feriados) da abertura do card, ou da
                    revisão pedida pelo cliente, até ele sair das etapas de proposta. Card ainda em
                    proposta conta até hoje. A carga histórica de cotações de 2025 fica de fora.
                  </p>
                </div>
              </div>

              <div className="panel rel-resultado">
                <div className="panel-head">
                  <div className="panel-title">Oportunidades</div>
                  <div className="sub">da mais lenta para a mais rápida</div>
                </div>
                <div className="panel-body">
                  {relatorio.truncado && (
                    <p className="field-hint" style={{ marginBottom: 12 }}>
                      O período tem mais oportunidades do que a lista mostra de uma vez. O
                      histograma conta todas; estreite o filtro para ver o restante na lista.
                    </p>
                  )}
                  <div className="sla-tabela">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Empresa</th>
                          <th>Responsável</th>
                          <th>Etapa</th>
                          <th>Início da contagem</th>
                          <th>Saiu da proposta</th>
                          <th className="num">Dias úteis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {relatorio.rows.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <Link href={`/dashboard/pipeline/${o.id}`}>
                                {o.company ? companyRazaoSocialName(o.company) : "—"}
                              </Link>
                              {o.status !== "open" && (
                                <div className="t-sub">{STATUS_LABEL[o.status] ?? o.status}</div>
                              )}
                            </td>
                            <td>{nomeDe(o.ownerUserId)}</td>
                            <td>{o.etapa}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {diaBR(o.inicioSla)}
                              {o.revisado && <div className="t-sub">revisão do cliente</div>}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {o.fimSla ? diaBR(o.fimSla) : <span className="sla-pendente">Em andamento</span>}
                            </td>
                            <td className="num">{o.dias}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Resumo({ resumo }: { resumo: SlaResumo }) {
  return (
    <div className="stat-grid">
      <div className="stat-tile">
        <div className="stat-label">Oportunidades</div>
        <div className="stat-value">{resumo.total}</div>
        <div className="sub">medidas no período</div>
      </div>
      <div className="stat-tile blue">
        <div className="stat-label">Mediana</div>
        <div className="stat-value">{resumo.mediana != null ? numero(resumo.mediana) : "—"}</div>
        <div className="sub">dias úteis · média {resumo.media != null ? numero(resumo.media) : "—"}</div>
      </div>
      <div className="stat-tile green">
        <div className="stat-label">{pct(resumo.ateCorte / resumo.total)} saem em até</div>
        <div className="stat-value">{resumo.diasNoCorte ?? "—"}</div>
        <div className="sub">dias úteis</div>
      </div>
      <div className="stat-tile danger">
        <div className="stat-label">Mais lenta</div>
        <div className="stat-value">{resumo.maximo ?? "—"}</div>
        <div className="sub">dias úteis</div>
      </div>
      <div className="stat-tile purple">
        <div className="stat-label">Em andamento</div>
        <div className="stat-value">{resumo.pendentes}</div>
        <div className="sub">ainda em proposta</div>
      </div>
    </div>
  );
}

// Histograma em SVG desenhado no servidor (sem JavaScript no navegador,
// como o resto da tela). Barras encostadas, uma por dia útil de 0 ao
// maior SLA, inclusive os dias sem nenhuma proposta; o número de propostas
// vai em cima de cada barra e a mediana é a linha tracejada.
function Histograma({ faixas, resumo }: { faixas: SlaFaixa[]; resumo: SlaResumo }) {
  const W = 760;
  const H = 330;
  const m = { t: 30, r: 12, b: 50, l: 40 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  const maior = Math.max(...faixas.map((f) => f.total), 1);
  const passo = maior <= 10 ? 2 : maior <= 25 ? 5 : maior <= 50 ? 10 : Math.ceil(maior / 50) * 10;
  const topo = Math.ceil(maior / passo) * passo + (maior % passo === 0 ? passo : 0);
  const ticks = Array.from({ length: topo / passo + 1 }, (_, i) => i * passo);

  const y = (v: number) => m.t + ph - (v / topo) * ph;
  const banda = pw / faixas.length;
  const vao = Math.min(4, banda * 0.15);
  const cx = (i: number) => m.l + banda * i + banda / 2;
  // Muitas faixas: rótulo do eixo X em dia sim, dia não, pra não encostar.
  const pulo = banda < 22 ? Math.ceil(22 / banda) : 1;

  const barra = (i: number, v: number) => {
    const x0 = m.l + banda * i + vao / 2;
    const w = banda - vao;
    const y0 = y(v);
    const h = y(0) - y0;
    const r = Math.min(4, h, w / 2);
    return `M${x0},${y(0)}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y(0)}Z`;
  };

  const xMediana =
    resumo.mediana != null ? m.l + banda * resumo.mediana + banda / 2 : null;

  return (
    <svg
      className="sla-hist"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Histograma: quantidade de propostas por dias úteis de SLA"
    >
      {ticks.map((t) => (
        <g key={t}>
          {t > 0 && <line className="sla-grade" x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />}
          <text className="sla-tick" x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {t}
          </text>
        </g>
      ))}

      {faixas.map((f, i) => (
        <g key={f.dias}>
          {f.total > 0 && (
            <path className="sla-barra" d={barra(i, f.total)}>
              <title>
                {`${diasUteis(f.dias)}: ${f.total} proposta(s) (${pct(f.total / resumo.total)})` +
                  (f.pendentes > 0 ? ` · ${f.pendentes} em andamento` : "")}
              </title>
            </path>
          )}
          <text className="sla-valor" x={cx(i)} y={y(f.total) - 8} textAnchor="middle">
            {f.total}
          </text>
          {i % pulo === 0 && (
            <text className="sla-dia" x={cx(i)} y={y(0) + 20} textAnchor="middle">
              {f.dias}
            </text>
          )}
        </g>
      ))}

      <line className="sla-eixo" x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} />

      {xMediana != null && (
        <g>
          <line className="sla-mediana" x1={xMediana} x2={xMediana} y1={m.t - 6} y2={y(0)} />
          <text className="sla-tick" x={xMediana + 6} y={m.t - 10}>
            {`mediana: ${numero(resumo.mediana as number)} dias`}
          </text>
        </g>
      )}

      <text className="sla-tick" x={m.l + pw / 2} y={H - 6} textAnchor="middle">
        Dias úteis de SLA
      </text>
      <text
        className="sla-tick"
        x={12}
        y={m.t + ph / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${m.t + ph / 2})`}
      >
        Propostas
      </text>
    </svg>
  );
}
