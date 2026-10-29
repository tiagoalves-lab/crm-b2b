import { getServerAccessToken } from "@/lib/api/auth";
import { companyRazaoSocialName, listCompaniesResumo } from "@/lib/api/companies";
import { listMemberships } from "@/lib/api/memberships";
import { listOpportunities } from "@/lib/api/opportunities";
import { listRawLeads } from "@/lib/api/raw-leads";
import TopbarFilter, { TopbarFilterProvider } from "@/app/_components/topbar-filter";
import ConvertidosTable, { type ConvertidoRow } from "./convertidos-table";

// Leads convertidos que ainda NÃO viraram cliente (pedido do usuário,
// 2026-10-27: "crie um menu abaixo de funil de vendas 'Leads Convertidos',
// visão igual à da carteira de clientes"). É a fila do meio da jornada:
// saiu da triagem, mas ainda não comprou. Quem já comprou está na Carteira
// de clientes — a régua de cliente é a do backend (ehCliente, decisão 6.23).
//
// Propostas contam só o ciclo corrente (decisão 6.14): cotação da carga
// histórica (opp.origem) não é proposta deste lead.
export default async function LeadsConvertidosPage() {
  const token = await getServerAccessToken();

  const [{ items: aprovados }, { items: companies }, { items: opportunities }, membros] =
    await Promise.all([
      listRawLeads(token, { status: "aprovado" }),
      listCompaniesResumo(token),
      listOpportunities(token),
      listMemberships(token),
    ]);

  const nomePorUserId = new Map<string, string>();
  for (const m of membros) {
    if (m.name?.trim()) nomePorUserId.set(m.userId, m.name.trim());
  }
  const empresaPorId = new Map(companies.map((c) => [c.id, c]));

  // Uma linha por EMPRESA: dois leads convertidos apontando pra mesma
  // empresa viram uma linha só, com a primeira data de conversão.
  const porEmpresa = new Map<string, ConvertidoRow>();
  for (const lead of aprovados) {
    if (!lead.promotedCompanyId) continue;
    const company = empresaPorId.get(lead.promotedCompanyId);
    // Fora da lista: empresa excluída/fora da visão de quem olha, e quem
    // já virou cliente.
    if (!company || company.ehCliente) continue;
    const atual = porEmpresa.get(company.id);
    if (atual) {
      if (lead.convertedAt && (!atual.convertidoEm || lead.convertedAt < atual.convertidoEm)) {
        atual.convertidoEm = lead.convertedAt;
      }
      continue;
    }
    porEmpresa.set(company.id, {
      companyId: company.id,
      leadId: lead.id,
      nome: companyRazaoSocialName(company),
      cpfCnpj: company.cpfCnpj,
      cidade: company.cidade ? `${company.cidade}${company.uf ? `/${company.uf}` : ""}` : null,
      representante: lead.ownerUserId ? (nomePorUserId.get(lead.ownerUserId) ?? null) : null,
      convertidoEm: lead.convertedAt,
      propostas: 0,
      temOportunidade: false,
      ultimaProposta: null,
      ultimoContato: company.ultimoContato,
    });
  }

  for (const opp of opportunities) {
    const row = porEmpresa.get(opp.companyId);
    if (!row) continue;
    row.temOportunidade = true;
    if (opp.origem) continue;
    row.propostas += 1;
    if (!row.ultimaProposta || opp.createdAt > row.ultimaProposta) row.ultimaProposta = opp.createdAt;
  }

  const rows = Array.from(porEmpresa.values());
  const semProposta = rows.filter((r) => r.propostas === 0).length;

  return (
    <TopbarFilterProvider>
      <div className="topbar">
        <div>
          <div className="page-title">Leads convertidos</div>
          <div className="page-sub">
            {rows.length} lead(s) convertido(s) que ainda não compraram
            {semProposta > 0 ? ` — ${semProposta} sem proposta cadastrada` : ""}
          </div>
        </div>
        <TopbarFilter placeholder="Buscar empresa..." />
        <div />
      </div>

      <div className="content">
        <ConvertidosTable rows={rows} />
      </div>
    </TopbarFilterProvider>
  );
}
