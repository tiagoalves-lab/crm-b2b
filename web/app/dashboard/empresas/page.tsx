import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import {
  companyDisplayName,
  listCompaniesResumo,
  type CompanyResumo,
} from "@/lib/api/companies";
import { getMe } from "@/lib/api/me";
import { formatDateTimeBR } from "@/lib/format-date";
import ConfirmSubmitButton from "../membros/confirm-submit-button";
import EmpresasTable, { type EmpresaRow } from "./empresas-table";
import { calcularCurvaAbcAction } from "./actions";
import TopbarFilter, { TopbarFilterProvider } from "@/app/_components/topbar-filter";

type Filtro = "todas" | "lead" | "cliente";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    includeDeleted?: string;
    filtro?: string;
  }>;
}) {
  const { error, includeDeleted, filtro } = await searchParams;
  const token = await getServerAccessToken();

  const showDeleted = includeDeleted === "1";
  // Uma requisição só (2026-09-04): o backend já devolve os campos que a
  // tabela desenha e o LTV/última compra somados pelo banco. Antes eram
  // seis — 4 páginas de empresas + oportunidades + as 1.093 vendas.
  const [{ items: companies }, me] = await Promise.all([
    listCompaniesResumo(token, showDeleted),
    getMe(token),
  ]);
  // Representante não exclui nenhum tipo de registro (pedido do usuário,
  // 2026-08-06, ver PolicyService#can) — botão escondido aqui pra não
  // oferecer uma ação que o backend vai rejeitar de qualquer forma.
  const canDelete = me.membership.role !== "sales_rep";
  // Recalcular reclassifica a carteira inteira — mesma régua das outras
  // ações administrativas (o backend rejeita os demais papéis com 403).
  const podeCalcularAbc = me.membership.role === "owner" || me.membership.role === "admin";

  // Company-lead ainda em triagem (SPEC-CRM-GAMA.md §4.4) não é uma
  // empresa de verdade até ser aprovada — quem exclui agora é a própria
  // consulta do backend (CompanyService#resumoParaLista), mesmo critério
  // da view v_busca_empresa_lead. Ela aparece na tela Leads em vez desta.

  // Selo lead/cliente: a tag "cliente" já vem da importação real (291 das
  // 292 empresas do banco de produção têm essa tag) — usar "existe
  // opportunity won" aqui (alternativa que o SPEC-CRM-GAMA.md §4.1 também
  // previa) deixava tudo "lead" porque o pipeline deste CRM começou do
  // zero, sem oportunidade nenhuma pros clientes já existentes antes dele.
  const tipoOf = (c: CompanyResumo): "lead" | "cliente" =>
    c.tags.includes("cliente") ? "cliente" : "lead";

  // LTV/última compra somam Opportunity "won" de verdade (pipeline novo,
  // começou do zero) com sales_history (histórico de vendas importado do
  // eGestor, sem dono nem ligação com Opportunity de propósito — ver
  // migration 20260801230000_sales_history). A conta saiu daqui em
  // 2026-09-04: quem soma agora é o banco, num group by por empresa. A
  // coluna "Status" saiu em 2026-08-21: ela só espelhava o Tipo (cliente →
  // "ativo", lead → "negociando"), sem informação própria. No lugar entrou
  // a classe da curva ABC, que vem gravada na empresa.

  const currentFiltro: Filtro = filtro === "lead" || filtro === "cliente" ? filtro : "todas";
  const leadsCount = companies.filter((c) => tipoOf(c) === "lead").length;
  const clientesCount = companies.filter((c) => tipoOf(c) === "cliente").length;
  const visible = companies.filter(
    (c) => currentFiltro === "todas" || tipoOf(c) === currentFiltro,
  );
  // Ordem alfabética pela 1ª coluna (razão social — mesmo critério de
  // exibição do empresas-table.tsx).
  const rows: EmpresaRow[] = visible
    .map((company) => ({
      company,
      tipo: tipoOf(company),
      classe: company.curvaAbc,
      ltv: company.ltv,
      ultimaCompra: company.ultimaCompra,
    }))
    .sort((a, b) =>
      (a.company.razaoSocial?.trim() || companyDisplayName(a.company)).localeCompare(
        b.company.razaoSocial?.trim() || companyDisplayName(b.company),
        "pt-BR",
      ),
    );

  // Data da última apuração da curva ABC (é a mesma pra todas as empresas
  // — o cálculo carimba todo mundo de uma vez). Serve pra deixar claro na
  // tela de quando é a foto que a coluna Classe está mostrando.
  const curvaCalculadaEm = companies.reduce<string | null>(
    (max, c) => (c.curvaAbcCalculadaEm && (!max || c.curvaAbcCalculadaEm > max) ? c.curvaAbcCalculadaEm : max),
    null,
  );

  return (
    <TopbarFilterProvider>
      <div className="topbar">
        <div>
          <div className="page-title">Empresas</div>
          <div className="page-sub">
            {visible.length} de {companies.length} empresa(s)
            {showDeleted ? " (incluindo excluídas)" : ""}
            {curvaCalculadaEm
              ? ` — curva ABC calculada em ${formatDateTimeBR(curvaCalculadaEm)}`
              : " — curva ABC nunca calculada"}
          </div>
        </div>
        <TopbarFilter placeholder="Buscar empresa..." />
        <div style={{ display: "flex", gap: 8 }}>
          {podeCalcularAbc && (
            <form>
              <ConfirmSubmitButton
                className="btn btn-ghost"
                confirmMessage="Recalcular a curva ABC de todos os clientes? A classe A/B/C de cada empresa será atualizada pelo faturamento acumulado."
                formAction={calcularCurvaAbcAction}
                pendingLabel="Calculando…"
              >
                Calcular curva ABC
              </ConfirmSubmitButton>
            </form>
          )}
          <Link href="/dashboard/empresas/nova" className="btn btn-primary">
            + Nova empresa
          </Link>
        </div>
      </div>

      <div className="content">
        {error && <div className="error-banner">{error}</div>}

        <EmpresasTable
          rows={rows}
          currentFiltro={currentFiltro}
          showDeleted={showDeleted}
          counts={{ todas: companies.length, lead: leadsCount, cliente: clientesCount }}
          canDelete={canDelete}
        />
      </div>
    </TopbarFilterProvider>
  );
}
