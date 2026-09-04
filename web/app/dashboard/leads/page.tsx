import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { listContactsByCompanyIds } from "@/lib/api/contacts";
import type { Contact } from "@/lib/api/types";
import { effectiveTier, listRawLeads, TIER_LABEL, type ScoreTier } from "@/lib/api/raw-leads";
import ImportContactsToggle from "./import-contacts-toggle";
import LeadsTable from "./leads-table";
import RescoreButton from "./rescore-button";
import TopbarFilter, { TopbarFilterProvider } from "@/app/_components/topbar-filter";

type TierFilter = "todos" | ScoreTier | "fila" | "descartados";

// Sentinela pro filtro "Sem tag" (pedido do usuário, 2026-08-10) — valor
// de query string que não colide com tag nenhuma de verdade (tag livre
// digitada pelo usuário nunca começa com "__"), pra distinguir de
// currentTag === "" (que significa "sem filtro", mostra tudo).
const NO_TAG_VALUE = "__sem_tag__";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tier?: string; q?: string; tag?: string; segmento?: string }>;
}) {
  const { error, tier, q, tag, segmento } = await searchParams;
  const token = await getServerAccessToken();

  const [{ items: novos }, { total: aprovados }, { items: descartadosItems }] = await Promise.all([
    listRawLeads(token, { status: "novo" }),
    listRawLeads(token, { status: "aprovado", pageSize: 1 }),
    listRawLeads(token, { status: "descartado" }),
  ]);

  const quenteCount = novos.filter((r) => effectiveTier(r) === "quente").length;
  const mornoCount = novos.filter((r) => effectiveTier(r) === "morno").length;
  const frioCount = novos.filter((r) => effectiveTier(r) === "frio").length;

  const currentTier: TierFilter =
    tier === "quente" || tier === "morno" || tier === "frio" || tier === "fila" || tier === "descartados"
      ? tier
      : "todos";
  const search = (q ?? "").trim().toLowerCase();
  const currentTag = (tag ?? "").trim();
  const currentSegmento = (segmento ?? "").trim();

  // Filtro por tag/segmento (2026-08-05, pedido direto do usuário) — mesmo
  // padrão do filtro por tier/busca: tudo client-side a partir da lista já
  // carregada (até 200 leads), sem round-trip novo no backend. O conjunto
  // de valores disponíveis pro filtro vem da mesma base que a aba atual
  // usa (novos ou descartados), pra nunca oferecer um valor sem lead
  // nenhum pra mostrar naquela aba.
  const tagBase = currentTier === "descartados" ? descartadosItems : novos;
  const availableTags = Array.from(new Set(tagBase.flatMap((r) => r.tags))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const availableSegmentos = Array.from(
    new Set(tagBase.map((r) => r.segmento).filter((s): s is string => Boolean(s))),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  // Só oferece o chip "Sem tag" se existir pelo menos um lead sem tag na
  // aba atual — mesmo critério de availableTags (nunca mostra opção sem
  // nada pra filtrar).
  const hasUntagged = tagBase.some((r) => r.tags.length === 0);

  const searchFilter = (r: (typeof novos)[number]) =>
    !search ||
    r.razaoSocial.toLowerCase().includes(search) ||
    (r.cnaePrincipal ?? "").toLowerCase().includes(search) ||
    (r.cnaeDescricao ?? "").toLowerCase().includes(search);
  const tagFilter = (r: (typeof novos)[number]) =>
    !currentTag || (currentTag === NO_TAG_VALUE ? r.tags.length === 0 : r.tags.includes(currentTag));
  const segmentoFilter = (r: (typeof novos)[number]) => !currentSegmento || r.segmento === currentSegmento;

  const rows =
    currentTier === "descartados"
      ? descartadosItems.filter(searchFilter).filter(tagFilter).filter(segmentoFilter)
      : novos
          .filter((r) => currentTier === "todos" || currentTier === "fila" || effectiveTier(r) === currentTier)
          .filter(searchFilter)
          .filter(tagFilter)
          .filter(segmentoFilter)
          .sort((a, b) => b.score - a.score);

  // Coluna "Contatos" (2026-08-07, pedido direto do usuário) — uma
  // chamada só (listContactsByCompanyIds) pras empresas efetivamente
  // exibidas na aba atual, agrupada num Map por companyId. Só as linhas
  // visíveis (não a base inteira novos+descartados) pra não buscar
  // contato de uma aba que nem está sendo renderizada.
  const rowCompanyIds = Array.from(
    new Set(rows.map((r) => r.promotedCompanyId).filter((id): id is string => Boolean(id))),
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

  const extraParams = `${q ? `&q=${encodeURIComponent(q)}` : ""}${currentTag ? `&tag=${encodeURIComponent(currentTag)}` : ""}${currentSegmento ? `&segmento=${encodeURIComponent(currentSegmento)}` : ""}`;
  const tabHref = (t: TierFilter) => `/dashboard/leads?tier=${t}${extraParams}`;
  const tagHref = (t: string) =>
    `/dashboard/leads?tier=${currentTier}${q ? `&q=${encodeURIComponent(q)}` : ""}${t ? `&tag=${encodeURIComponent(t)}` : ""}${currentSegmento ? `&segmento=${encodeURIComponent(currentSegmento)}` : ""}`;
  const segmentoHref = (s: string) =>
    `/dashboard/leads?tier=${currentTier}${q ? `&q=${encodeURIComponent(q)}` : ""}${currentTag ? `&tag=${encodeURIComponent(currentTag)}` : ""}${s ? `&segmento=${encodeURIComponent(s)}` : ""}`;

  return (
    <TopbarFilterProvider>
      <div className="topbar">
        <div>
          <div className="page-title">Prospecção</div>
          <div className="page-sub">Relação de empresas com oportunidades de negócios</div>
        </div>
        <TopbarFilter placeholder="Buscar razão social, CNPJ, CNAE, cidade… (Enter busca em tudo)" />
        <div style={{ display: "flex", gap: 8 }}>
          <RescoreButton />
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
          <div className="fstat q">
            <div className="fstat-v" style={{ color: "var(--green)" }}>
              {quenteCount}
            </div>
            <div className="fstat-l">{TIER_LABEL.quente} (≥70)</div>
          </div>
          <div className="fstat m">
            <div className="fstat-v" style={{ color: "var(--accent-secondary)" }}>
              {mornoCount}
            </div>
            <div className="fstat-l">{TIER_LABEL.morno} (45–69)</div>
          </div>
          <div className="fstat f">
            <div className="fstat-v" style={{ color: "var(--danger)" }}>
              {frioCount}
            </div>
            <div className="fstat-l">{TIER_LABEL.frio} (&lt;45)</div>
          </div>
          <div className="fstat">
            <div className="fstat-v" style={{ color: "var(--text-secondary)" }}>
              {aprovados}/{descartadosItems.length}
            </div>
            <div className="fstat-l">Aprov. / descart.</div>
          </div>
        </div>

        <div className="toolbar">
          <div className="seg">
            <Link href={tabHref("todos")} className={currentTier === "todos" ? "active" : undefined}>
              Todos ({novos.length})
            </Link>
            <Link href={tabHref("quente")} className={currentTier === "quente" ? "active" : undefined}>
              {TIER_LABEL.quente} ({quenteCount})
            </Link>
            <Link href={tabHref("morno")} className={currentTier === "morno" ? "active" : undefined}>
              {TIER_LABEL.morno} ({mornoCount})
            </Link>
            <Link href={tabHref("frio")} className={currentTier === "frio" ? "active" : undefined}>
              {TIER_LABEL.frio} ({frioCount})
            </Link>
            <Link href={tabHref("fila")} className={currentTier === "fila" ? "active" : undefined}>
              Fila ({novos.length})
            </Link>
            <Link href={tabHref("descartados")} className={currentTier === "descartados" ? "active" : undefined}>
              Descartados ({descartadosItems.length})
            </Link>
          </div>
        </div>

        {(availableTags.length > 0 || hasUntagged) && (
          <div className="tag-filter-row">
            <Link href={tagHref("")} className={currentTag === "" ? "tag-chip active" : "tag-chip"}>
              Todas as tags
            </Link>
            {hasUntagged && (
              <Link
                href={tagHref(NO_TAG_VALUE)}
                className={currentTag === NO_TAG_VALUE ? "tag-chip active" : "tag-chip"}
              >
                Sem tag
              </Link>
            )}
            {availableTags.map((t) => (
              <Link key={t} href={tagHref(t)} className={currentTag === t ? "tag-chip active" : "tag-chip"}>
                {t}
              </Link>
            ))}
          </div>
        )}

        {availableSegmentos.length > 0 && (
          <div className="tag-filter-row">
            <Link href={segmentoHref("")} className={currentSegmento === "" ? "tag-chip active" : "tag-chip"}>
              Todos os segmentos
            </Link>
            {availableSegmentos.map((s) => (
              <Link key={s} href={segmentoHref(s)} className={currentSegmento === s ? "tag-chip active" : "tag-chip"}>
                {s}
              </Link>
            ))}
          </div>
        )}

        <LeadsTable rows={rows} readOnly={currentTier === "descartados"} contactsByCompanyId={contactsByCompanyId} />
      </div>
    </TopbarFilterProvider>
  );
}
