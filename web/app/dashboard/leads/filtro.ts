import type { Contact, RawLead } from "@/lib/api/types";
import { normalizeForFilter } from "@/app/_components/topbar-filter";

// Régua de "este lead bate com o que foi digitado no cabeçalho".
//
// Extraída de leads-table.tsx (2026-09-18) porque agora tem dois leitores:
// a tabela, que esconde linha, e as abas, que precisam CONTAR quantos
// resultados cada aba tem. Sem isso o usuário digitava um nome, a aba
// aberta dizia "nenhum lead bate com o filtro" e não havia como saber que
// a empresa estava em outra aba — foi exatamente o furo que ele achou
// buscando "crdc" na aba Prospects.
export function leadBateComBusca(
  lead: RawLead,
  needle: string,
  contactsByCompanyId: Record<string, Contact[]> = {},
): boolean {
  if (!needle) return true;
  const contatos = lead.promotedCompanyId ? (contactsByCompanyId[lead.promotedCompanyId] ?? []) : [];
  const texto = [
    lead.razaoSocial,
    lead.cnpj,
    lead.municipio,
    lead.uf,
    lead.cnaePrincipal,
    lead.cnaeDescricao,
    lead.porte,
    lead.segmento,
    lead.situacao,
    ...lead.tags,
    ...contatos.flatMap((c) => [c.nome, c.email, c.telefone, c.cargo]),
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ");
  return normalizeForFilter(texto).includes(needle);
}
