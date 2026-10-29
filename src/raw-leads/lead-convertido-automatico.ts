import { Prisma } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';

// De onde veio a conversão — a Timeline da ficha escreve o texto a partir
// disto. Sem `origem` no payload (registros de antes de 2026-10-28 e o
// "Aprovar" da Prospecção) vale "prospeccao".
export type OrigemConversao = 'prospeccao' | 'oportunidade' | 'cotacoes';

// Registro da conversão na Timeline da ficha (pedido do usuário,
// 2026-10-28: "constar nas atividades o log da conversão, data/hora e qual
// usuário"). Mesmo `lead_approved` que o RawLeadService#approve sempre
// gravou — um registro só pros três caminhos, pra Timeline e o Painel
// lerem igual. `actorUserId` null = conversão sem pessoa por trás (app de
// cotações, que chama com token de integração), a ficha mostra "Sistema".
//
// Escrito direto pelo tx, não pelo ActivityService: é função solta chamada
// de três módulos, e injetar o service em cada um só pra isto criaria
// ciclo de módulo (mesmo motivo de ActivityService#avancarEtapaDoLead).
export async function registrarConversao(
  tx: TenantTx,
  input: {
    workspaceId: string;
    companyId: string;
    actorUserId: string | null;
    origem: OrigemConversao;
    razaoSocial: string | null;
  },
): Promise<void> {
  await tx.activity.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      type: 'field_update',
      payload: {
        action: 'lead_approved',
        origem: input.origem,
        razaoSocial: input.razaoSocial,
      },
      companyId: input.companyId,
    },
  });
}

// Empresa que ganha oportunidade sem ter passado pela Prospecção (2026-09-28,
// achado do usuário com a G8 Brindes): cadastrada direto no card de
// oportunidade ou vinda do app de cotações, ela não era cliente (não
// comprou) nem lead (não tinha raw_lead) — sumia da Carteira de clientes E
// do Funil de vendas. Pela régua 6.23 de docs/regras-de-negocio.md, empresa
// com proposta que ainda não comprou mora em "Leads convertidos"; aqui ela
// ganha o lead que faltava, já convertido, na etapa Negociação/Fechamento.
//
// Quem decide se falta é a function empresa_precisa_lead_convertido
// (SECURITY DEFINER, ver migration 20260928160000): sob a RLS do
// representante, lead/venda de outro dono não aparecem e a checagem comum
// criaria duplicata ou lead pra cliente.
export async function garantirLeadConvertido(
  tx: TenantTx,
  workspaceId: string,
  companyId: string,
  ownerUserId: string,
  conversao: { actorUserId: string | null; origem: OrigemConversao },
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ precisa: boolean }>>(
    Prisma.sql`SELECT public.empresa_precisa_lead_convertido(${workspaceId}::uuid, ${companyId}::uuid) AS precisa`,
  );
  if (!rows[0]?.precisa) return;

  const company = await tx.company.findFirst({
    where: { id: companyId, workspaceId },
  });
  if (!company) return;

  const razaoSocial = company.razaoSocial ?? company.fantasia ?? '';
  const agora = new Date();
  await tx.rawLead.create({
    data: {
      workspaceId,
      razaoSocial,
      emRecuperacaoJudicial: company.emRecuperacaoJudicial,
      cnpj: company.cpfCnpj,
      uf: company.uf,
      municipio: company.cidade,
      fonte: 'manual',
      status: 'aprovado',
      etapa: 'negociacao',
      convertedAt: agora,
      promotedCompanyId: company.id,
      ownerUserId,
    },
  });

  await registrarConversao(tx, {
    workspaceId,
    companyId: company.id,
    actorUserId: conversao.actorUserId,
    origem: conversao.origem,
    razaoSocial,
  });
}
