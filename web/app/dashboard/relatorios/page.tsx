import { getServerAccessToken } from "@/lib/api/auth";
import { listOpportunities } from "@/lib/api/opportunities";
import { listPipelines } from "@/lib/api/pipelines";
import { listRawLeads } from "@/lib/api/raw-leads";
import type { LeadFonte } from "@/lib/api/types";
import TopbarFilter from "@/app/_components/topbar-filter";

function brl(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

const FONTE_COLOR: Record<LeadFonte, string> = {
  econodata: "#4a9fe0",
  apify: "#9b7fe0",
  comexstat: "#3fb96b",
  manual: "#c7a34a",
};

// SVG estático (sem client JS) do funil de origem — mesma matemática de
// donutSVG() do protótipo, só reescrita como cálculo server-side.
function donutSvg(counts: Array<[string, number]>, total: number): string {
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segments = counts
    .map(([fonte, value]) => {
      const frac = value / total;
      const len = frac * c;
      const seg = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${FONTE_COLOR[fonte as LeadFonte] ?? "#999"}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)" />`;
      offset += len;
      return seg;
    })
    .join("");
  return `<svg width="140" height="140" viewBox="0 0 140 140">${segments}<text x="70" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="currentColor">${total}</text><text x="70" y="84" text-anchor="middle" font-size="9" fill="currentColor">LEADS</text></svg>`;
}

// Relatórios (SPEC-CRM-GAMA.md §4.5): taxa de fechamento, ciclo médio,
// ticket médio, origem dos leads, funil por stage. "Pipeline por produto"
// do protótipo fica de fora — não existe conceito de produto em
// Opportunity neste schema (não é gap, é o protótipo simulando um campo
// que a Gama não pediu no backend real).
export default async function RelatoriosPage() {
  const token = await getServerAccessToken();
  const [{ items: pipelines }, { items: opportunities }, { items: leads }] = await Promise.all([
    listPipelines(token),
    listOpportunities(token),
    // Sem status: soma novo+aprovado+descartado pras métricas abaixo — o
    // pageSize explícito era o mesmo teto de 200 que escondia leads (ver
    // comentário em listRawLeads), removido pra usar o novo default.
    listRawLeads(token),
  ]);

  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];

  const ativas = opportunities.filter((o) => !o.deletedAt);
  const abertas = ativas.filter((o) => o.status === "open");
  const ganhas = ativas.filter((o) => o.status === "won");
  const perdidas = ativas.filter((o) => o.status === "lost");
  const encerradas = ganhas.length + perdidas.length;
  const taxaFechamento = encerradas > 0 ? Math.round((ganhas.length / encerradas) * 100) : 0;

  const ticketMedio =
    ativas.length > 0 ? ativas.reduce((s, o) => s + Number(o.amount), 0) / ativas.length : 0;

  const cicloDias = [...ganhas, ...perdidas]
    .filter((o) => o.closedAt)
    .map((o) => {
      const dias = (new Date(o.closedAt!).getTime() - new Date(o.createdAt).getTime()) / 86_400_000;
      return Math.max(dias, 0);
    });
  const cicloMedio = cicloDias.length > 0 ? Math.round(cicloDias.reduce((s, d) => s + d, 0) / cicloDias.length) : 0;

  const totalLeads = leads.length;
  const leadsAprovados = leads.filter((l) => l.status === "aprovado").length;
  const taxaAprovacao = totalLeads > 0 ? Math.round((leadsAprovados / totalLeads) * 100) : 0;

  const fonteMap = new Map<LeadFonte, number>();
  for (const lead of leads) {
    fonteMap.set(lead.fonte, (fonteMap.get(lead.fonte) ?? 0) + 1);
  }
  const fonteEntries = [...fonteMap.entries()].sort((a, b) => b[1] - a[1]);

  const funil = stages.map((stage) => ({
    stage,
    count: abertas.filter((o) => o.stageId === stage.id).length,
  }));
  const maxFunil = Math.max(...funil.map((f) => f.count), ganhas.length, perdidas.length, 1);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Relatórios</div>
          <div className="page-sub">Conversão, ciclo e previsão</div>
        </div>
        <TopbarFilter />
      </div>

      <div className="content">
      <div className="stat-grid">
        <div className="stat-tile green">
          <div className="stat-label">Taxa de fechamento</div>
          <div className="stat-value">{taxaFechamento}%</div>
          <div className="sub">
            {ganhas.length} ganhas / {encerradas} encerradas
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Ciclo médio de venda</div>
          <div className="stat-value">{cicloMedio} dias</div>
          <div className="sub">criação → fechamento</div>
        </div>
        <div className="stat-tile blue">
          <div className="stat-label">Ticket médio</div>
          <div className="stat-value">{brl(ticketMedio)}</div>
          <div className="sub">por oportunidade</div>
        </div>
        <div className="stat-tile purple">
          <div className="stat-label">Taxa de aprovação (triagem)</div>
          <div className="stat-value">{taxaAprovacao}%</div>
          <div className="sub">
            {leadsAprovados}/{totalLeads} leads aprovados
          </div>
        </div>
      </div>

      <div className="report-grid" style={{ marginTop: 20 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
              Funil de conversão — nº de negócios por etapa
            </div>
          </div>
          <div className="panel-body">
          <div className="funnel-bar">
            {funil.map((f) => (
              <div className="fbar" key={f.stage.id}>
                <div className="fbar-label">{f.stage.name}</div>
                <div className="fbar-track">
                  <div className="fbar-fill" style={{ width: `${Math.max((f.count / maxFunil) * 100, 5)}%` }}>
                    {f.count}
                  </div>
                </div>
              </div>
            ))}
            <div className="fbar">
              <div className="fbar-label" style={{ color: "var(--accent-secondary)" }}>
                Ganho
              </div>
              <div className="fbar-track">
                <div className="fbar-fill" style={{ width: `${Math.max((ganhas.length / maxFunil) * 100, 5)}%` }}>
                  {ganhas.length}
                </div>
              </div>
            </div>
            <div className="fbar">
              <div className="fbar-label" style={{ color: "var(--danger)" }}>
                Perdido
              </div>
              <div className="fbar-track">
                <div
                  className="fbar-fill"
                  style={{
                    width: `${Math.max((perdidas.length / maxFunil) * 100, 5)}%`,
                    background: "linear-gradient(90deg, var(--danger), #ff8a75)",
                  }}
                >
                  {perdidas.length}
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 010 20" />
              </svg>
              Origem dos leads
            </div>
          </div>
          <div className="panel-body">
          {totalLeads > 0 ? (
            <div className="donut-wrap">
              <div dangerouslySetInnerHTML={{ __html: donutSvg(fonteEntries, totalLeads) }} />
              <div className="legend">
                {fonteEntries.map(([fonte, value]) => (
                  <div key={fonte} className="leg-item">
                    <span className="leg-dot" style={{ background: FONTE_COLOR[fonte as LeadFonte] ?? "#999" }} />
                    <span>{fonte}</span>
                    <span className="leg-val">
                      {value} ({Math.round((value / totalLeads) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="sub">Nenhum lead na triagem ainda.</p>
          )}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
