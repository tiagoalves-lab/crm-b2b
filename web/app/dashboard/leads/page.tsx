import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAccessToken } from "@/lib/api/auth";
import { listContactsByCompanyIds } from "@/lib/api/contacts";
import type { Contact } from "@/lib/api/types";
import { effectiveTier, listRawLeads, TIER_LABEL, type ScoreTier } from "@/lib/api/raw-leads";
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
//   Descartados         → saíram do fluxo
//
// Lead convertido não aparece aqui (2026-10-29, pedido do usuário): tem
// menu próprio, Leads convertidos (/dashboard/leads-convertidos).
type Aba = "prospects" | "qualificados" | "descartados";
type TierFilter = Aba | ScoreTier;

const ABA_DE: Record<string, Aba> = {
  prospects: "prospects",
  qualificados: "qualificados",
  quente: "qualificados",
  morno: "qualificados",
  frio: "qualificados",
  descartados: "descartados",
};

export default async function LeadsPage({
  searchParams,
}: {
  // `tag`/`segmento` saíram da querystring em 2026-09-24: filtrar virou
  // estado do navegador (modal de Filtros), sem recarregar a tela.
  searchParams: Promise<{ error?: string; tier?: string; q?: string }>;
}) {
  const { error, tier, q } = await searchParams;
  // Link antigo pra aba que saiu (2026-10-29) cai no menu próprio.
  if (tier === "convertidos") redirect("/dashboard/leads-convertidos");
  const token = await getServerAccessToken();

  const [{ items: novos }, { total: aprovados }, { items: descartadosItems }, membros] =
    await Promise.all([
      listRawLeads(token, { status: "novo" }),
      // Só o total, pro contador "Aprov. / descart." — o lead convertido
      // não aparece mais nesta tela (2026-10-29).
      listRawLeads(token, { status: "aprovado", pageSize: 1 }),
      listRawLeads(token, { status: "descartado" }),
      listMemberships(token),
    ]);

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
  // de filtro oferece (2026-09-24). A lista sai das duas bases, não só da
  // aba aberta: filtrar é estado do navegador agora e vale nas abas e no
  // quadro ao mesmo tempo, então uma tag que só existe em
  // Descartados não pode sumir da lista por causa da aba em que a pessoa
  // está.
  const baseCompleta = [...novos, ...descartadosItems];
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
          descartados={descartadosFiltrados}
          contactsByCompanyId={contactsByCompanyId}
          nomePorUserId={nomePorUserId}
          tagsDisponiveis={availableTags}
          segmentosDisponiveis={availableSegmentos}
        />
      </div>
    </TopbarFilterProvider>
  );
}
