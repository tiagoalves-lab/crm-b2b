import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listContactsByCompanyIds } from "@/lib/api/contacts";
import type { Contact, RawLead } from "@/lib/api/types";
import { effectiveTier, listRawLeads, TIER_LABEL, type ScoreTier } from "@/lib/api/raw-leads";
import { listOpportunities } from "@/lib/api/opportunities";
import { listMemberships } from "@/lib/api/memberships";
import ImportContactsToggle from "./import-contacts-toggle";
import ProspeccaoTabs from "./prospeccao-tabs";
import TopbarFilter, { TopbarFilterProvider } from "@/app/_components/topbar-filter";

// Abas da Prospecção (reestruturação pedida pelo usuário, 2026-09-18) —
// passam a espelhar a jornada do lead (decisões 6.1/6.2 de
// docs/regras-de-negocio.md) em vez de faixas de classificação soltas:
//
//   Prospects           → na fila, ainda sem prazo informado ao SDR
//   Leads qualificados  → já têm prazo; as faixas Curto/Médio/Longo viram
//                         sub-filtro DESTA aba, não abas de primeiro nível
//   Leads convertidos   → têm proposta no Pipeline
//   Descartados         → saíram do fluxo
//
// "Leads convertidos" sai do PIPELINE (oportunidades), não da lista de
// leads: é a regra que o usuário fechou — quem manda é o registro de
// oportunidade, e a carga antiga de empresas feita direto em Empresas fica
// de fora por consequência.
type Aba = "prospects" | "qualificados" | "convertidos" | "descartados";
type TierFilter = Aba | ScoreTier;

const ABA_DE: Record<string, Aba> = {
  prospects: "prospects",
  qualificados: "qualificados",
  quente: "qualificados",
  morno: "qualificados",
  frio: "qualificados",
  convertidos: "convertidos",
  descartados: "descartados",
};

// Uma linha por LEAD CONVERTIDO do CRM (2026-09-21, pedido do usuário:
// "os leads convertidos estão herdando a importação ainda, retratar
// somente registros do CRM").
//
// A lista era montada a partir das oportunidades, então as 56 empresas que
// só têm cotação da carga de jul-set/2025 entravam aqui como se fossem
// lead convertido — nunca foram lead, são cliente com histórico. Agora a
// base é o lead convertido (raw_lead aprovado), e a contagem de propostas
// olha só o ciclo corrente. A carteira histórica continua inteira no
// Pipeline, nos relatórios e em Carteira de clientes.
interface ConvertidoRow {
  companyId: string;
  nome: string;
  abertas: number;
  ganhas: number;
  perdidas: number;
  valorAberto: number;
  ultimoMovimento: string | null;
}

async function carregarConvertidos(token: string, aprovados: RawLead[]): Promise<ConvertidoRow[]> {
  const { items } = await listOpportunities(token);
  const porEmpresa = new Map<string, ConvertidoRow>();

  // A base é o lead convertido — inclusive o que ainda NÃO tem proposta
  // (2026-09-18): antes ele não aparecia em aba nenhuma, porque saía de
  // Prospects ao ser convertido e a lista só olhava o Pipeline. É
  // justamente a fila que espera ação: converteu e não cadastrou.
  for (const lead of aprovados) {
    if (!lead.promotedCompanyId) continue;
    porEmpresa.set(lead.promotedCompanyId, {
      companyId: lead.promotedCompanyId,
      nome: lead.razaoSocial,
      abertas: 0,
      ganhas: 0,
      perdidas: 0,
      valorAberto: 0,
      ultimoMovimento: null,
    });
  }

  for (const opp of items) {
    // Fora a carga histórica (opp.origem) e fora empresa que não veio de
    // lead convertido — este é o funil de lead, não a carteira.
    if (opp.origem) continue;
    const row = porEmpresa.get(opp.companyId);
    if (!row) continue;
    if (opp.status === "open") {
      row.abertas += 1;
      row.valorAberto += Number(opp.amount);
    } else if (opp.status === "won") {
      row.ganhas += 1;
    } else {
      row.perdidas += 1;
    }
    const movimento = opp.closedAt ?? opp.createdAt;
    if (!row.ultimoMovimento || movimento > row.ultimoMovimento) row.ultimoMovimento = movimento;
    porEmpresa.set(opp.companyId, row);
  }
  // Ordem por urgência: negociação viva primeiro, depois quem foi
  // convertido e está SEM proposta (é o que espera ação), e por último o
  // que já teve resultado, do movimento mais recente pro mais antigo.
  const semProposta = (r: ConvertidoRow) => r.abertas + r.ganhas + r.perdidas === 0;
  const grupo = (r: ConvertidoRow) => (r.abertas > 0 ? 0 : semProposta(r) ? 1 : 2);
  return Array.from(porEmpresa.values()).sort((a, b) => {
    if (grupo(a) !== grupo(b)) return grupo(a) - grupo(b);
    if (grupo(a) === 1) return a.nome.localeCompare(b.nome, "pt-BR");
    return (b.ultimoMovimento ?? "").localeCompare(a.ultimoMovimento ?? "");
  });
}

export default async function LeadsPage({
  searchParams,
}: {
  // `tag`/`segmento` saíram da querystring em 2026-09-24: filtrar virou
  // estado do navegador (modal de Filtros), sem recarregar a tela.
  searchParams: Promise<{ error?: string; tier?: string; q?: string }>;
}) {
  const { error, tier, q } = await searchParams;
  const token = await getServerAccessToken();

  const [{ items: novos }, { items: aprovadosItems }, { items: descartadosItems }, membros] =
    await Promise.all([
      listRawLeads(token, { status: "novo" }),
      // As linhas, não só o total (2026-09-18): lead convertido sem
      // proposta também precisa aparecer na aba Leads convertidos.
      listRawLeads(token, { status: "aprovado" }),
      listRawLeads(token, { status: "descartado" }),
      listMemberships(token),
    ]);
  const aprovados = aprovadosItems.length;

  // Coluna "Representante" (pedido do usuário, 2026-09-18: "para saber de
  // quem é o lead") — o lead guarda o id do dono; o nome vive no Supabase
  // Auth e chega junto com a lista de membros.
  const nomePorUserId: Record<string, string> = {};
  for (const m of membros) {
    if (m.name?.trim()) nomePorUserId[m.userId] = m.name.trim();
  }

  const quenteCount = novos.filter((r) => effectiveTier(r) === "quente").length;
  const mornoCount = novos.filter((r) => effectiveTier(r) === "morno").length;
  const frioCount = novos.filter((r) => effectiveTier(r) === "frio").length;
  const semClassificacao = novos.filter((r) => effectiveTier(r) === null).length;

  const currentTier: TierFilter =
    tier === "quente" || tier === "morno" || tier === "frio" || ABA_DE[tier ?? ""]
      ? (tier as TierFilter)
      : "prospects";
  const abaAtual: Aba = ABA_DE[currentTier] ?? "prospects";
  const search = (q ?? "").trim().toLowerCase();

  // Tags e segmentos que existem na Prospecção inteira — é o que o modal
  // de filtro oferece (2026-09-24). A lista sai das TRÊS bases, não só da
  // aba aberta: filtrar é estado do navegador agora e vale nas quatro
  // abas e no quadro ao mesmo tempo, então uma tag que só existe em
  // Descartados não pode sumir da lista por causa da aba em que a pessoa
  // está.
  const baseCompleta = [...novos, ...aprovadosItems, ...descartadosItems];
  const availableTags = Array.from(new Set(baseCompleta.flatMap((r) => r.tags))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const availableSegmentos = Array.from(
    new Set(baseCompleta.map((r) => r.segmento).filter((s): s is string => Boolean(s))),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const searchFilter = (r: (typeof novos)[number]) =>
    !search ||
    r.razaoSocial.toLowerCase().includes(search) ||
    (r.cnaePrincipal ?? "").toLowerCase().includes(search) ||
    (r.cnaeDescricao ?? "").toLowerCase().includes(search);

  // O servidor entrega as bases inteiras; quem separa as abas e quem
  // aplica tag/segmento é o componente de abas, no navegador (ver
  // prospeccao-tabs.tsx).
  const novosFiltrados = novos
    .filter(searchFilter)
    .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"));
  const descartadosFiltrados = descartadosItems.filter(searchFilter);
  // Os convertidos como LEAD (2026-09-23) — é o que o quadro Kanban põe
  // na coluna Negociação/Fechamento. A lista agregada por empresa
  // (`convertidos`, logo abaixo) continua servindo a aba da visão lista.
  const aprovadosFiltrados = aprovadosItems.filter(searchFilter);

  // Leads convertidos: uma linha por empresa que tem proposta no Pipeline.
  // Carregado em TODA visita, não só quando a aba está aberta (pedido do
  // usuário, 2026-09-18: "não está aparecendo os números de leads
  // convertidos") — o contador da aba precisa do número sempre. O custo é
  // marginal perto do que a tela já busca: a lista de oportunidades tem
  // ordem de centenas de linhas, contra ~900 leads e seus contatos.
  const convertidos = await carregarConvertidos(token, aprovadosItems);

  // Coluna "Contatos" (2026-08-07, pedido direto do usuário) — uma
  // chamada só (listContactsByCompanyIds), agrupada num Map por
  // companyId. Cobre as duas bases (fila e descartados) porque a troca de
  // aba agora acontece no navegador, sem voltar ao servidor: se buscasse
  // só a aba atual, mudar de aba mostraria linha sem contato.
  const rowCompanyIds = Array.from(
    new Set(
      [...novosFiltrados, ...descartadosFiltrados]
        .map((r) => r.promotedCompanyId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const previewContacts = await listContactsByCompanyIds(token, rowCompanyIds);
  const contactsByCompany = new Map<string, Contact[]>();
  for (const contact of previewContacts) {
    const list = contactsByCompany.get(contact.companyId) ?? [];
    list.push(contact);
    contactsByCompany.set(contact.companyId, list);
  }
  // A tabela é Client Component — Map não atravessa a fronteira RSC como
  // prop de forma confiável neste projeto (mesma regra já documentada em
  // tarefas-table.tsx), então vira objeto plano antes de repassar.
  const contactsByCompanyId: Record<string, Contact[]> = Object.fromEntries(contactsByCompany);

  return (
    <TopbarFilterProvider>
      <div className="topbar">
        <div>
          <div className="page-title">Funil de vendas</div>
          <div className="page-sub">Relação de empresas com oportunidades de negócios</div>
        </div>
        <TopbarFilter placeholder="Buscar razão social, CNPJ, CNAE, cidade…" />
        <div style={{ display: "flex", gap: 8 }}>
          <ImportContactsToggle />
          <Link href="/dashboard/leads/novo" className="btn btn-primary">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nova empresa
          </Link>
        </div>
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

        <div className="funnel-stat">
          <div className="fstat">
            <div className="fstat-v">{novos.length}</div>
            <div className="fstat-l">Na fila de triagem</div>
          </div>
          <div className="fstat">
            <div className="fstat-v" style={{ color: "var(--text-secondary)" }}>
              {semClassificacao}
            </div>
            <div className="fstat-l">Sem classificação</div>
          </div>
          <div className="fstat q">
            <div className="fstat-v" style={{ color: "var(--green)" }}>
              {quenteCount}
            </div>
            <div className="fstat-l">{TIER_LABEL.quente}</div>
          </div>
          <div className="fstat m">
            <div className="fstat-v" style={{ color: "var(--accent-secondary)" }}>
              {mornoCount}
            </div>
            <div className="fstat-l">{TIER_LABEL.morno}</div>
          </div>
          <div className="fstat f">
            <div className="fstat-v" style={{ color: "var(--danger)" }}>
              {frioCount}
            </div>
            <div className="fstat-l">{TIER_LABEL.frio}</div>
          </div>
          <div className="fstat">
            <div className="fstat-v" style={{ color: "var(--text-secondary)" }}>
              {aprovados}/{descartadosItems.length}
            </div>
            <div className="fstat-l">Aprov. / descart.</div>
          </div>
        </div>

        {/* As duas fileiras de pastilhas de tag/segmento que ficavam aqui
            foram apagadas em 2026-09-24: viraram o botão "Filtros" da
            barra, que abre o modal de seleção múltipla
            (leads/filtro-modal.tsx). Com 27 tags a fileira tomava três
            linhas da tela e só deixava escolher uma por vez. */}

        <ProspeccaoTabs
          abaInicial={abaAtual}
          novos={novosFiltrados}
          aprovados={aprovadosFiltrados}
          descartados={descartadosFiltrados}
          convertidos={convertidos}
          contactsByCompanyId={contactsByCompanyId}
          nomePorUserId={nomePorUserId}
          tagsDisponiveis={availableTags}
          segmentosDisponiveis={availableSegmentos}
        />
      </div>
    </TopbarFilterProvider>
  );
}
