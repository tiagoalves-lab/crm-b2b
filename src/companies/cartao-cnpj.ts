import type { Company } from '@prisma/client';
import type { CnpjLookupResult } from './company.service';
import type { UpdateCompanyDto } from './dto/update-company.dto';

// Merge "Cartão CNPJ da Receita Federal → Company", compartilhado por
// todos os caminhos que preenchem a aba "Dados cadastrais" da ficha:
//
//   - botão "Buscar dados" da ficha (web/app/dashboard/empresas/actions.ts
//     refreshCnpjDataAction — um registro por vez, via frontend);
//   - script de sanitização em lote (scripts/sanitizar-cadastros-cnpj.ts);
//   - empresa que entra sozinha pelo eGestor (EgestorCartaoCnpjService,
//     2026-08-19) — antes disso ela nascia SEM ficha da Receita e ficava
//     com a aba vazia até alguém clicar em "Buscar dados" na mão.
//
// A regra de merge nasceu no script (2026-08-13) e foi extraída pra cá pra
// não existir em duas versões que divergem com o tempo. Decisões de
// segurança de dado preservadas na íntegra (evitar perder dado real
// coletado pela equipe, que o Cartão CNPJ não tem como saber que existe):
//
//   - emails/fones: só grava quando a Receita devolve algo E o conjunto
//     atual está vazio ou é subconjunto do que a Receita tem — nunca APAGA
//     e-mail/telefone já cadastrado que a Receita não conhece (comum
//     quando o vendedor já anotou o contato de verdade, ou quando o dado
//     veio do eGestor). Divergência real fica de fora e é sinalizada em
//     `emailsFonesConflito` pra revisão manual.
//   - demais campos (razão social, fantasia, endereço, recuperação
//     judicial): a Receita manda quando devolve valor preenchido — é a
//     base oficial, e é exatamente isso que a ficha promete mostrar.

export interface CartaoCnpjSnapshot {
  situacaoCadastral: string | null;
  dataAbertura: string | null;
  porte: string | null;
  naturezaJuridica: string | null;
  cnaePrincipal: string | null;
  cnaeSecundarios: string[];
  estabelecimento: string | null;
  telefoneReceita: string | null;
  emailReceita: string | null;
  fonteFederal: string;
  buscadoEm: string;
}

// Só o que o merge lê — assinatura frouxa de propósito pra aceitar tanto o
// `Company` do Prisma quanto o objeto vindo da API (web) sem conversão.
export type CompanyParaCartaoCnpj = Pick<
  Company,
  | 'razaoSocial'
  | 'fantasia'
  | 'logradouro'
  | 'numero'
  | 'complemento'
  | 'bairro'
  | 'cep'
  | 'cidade'
  | 'uf'
  | 'emRecuperacaoJudicial'
  | 'tipo'
  | 'cpfCnpj'
  | 'emails'
  | 'fones'
> & { customFields: unknown };

export interface CampoAlteradoCartaoCnpj {
  campo: string;
  de: unknown;
  para: unknown;
}

export interface AtualizacaoCartaoCnpj {
  // Pronto pra CompanyService#update — já traz `customFields` com o
  // snapshot mesclado ao que a empresa já tinha (inscrição estadual etc.
  // continuam intactas).
  dto: UpdateCompanyDto;
  alterados: CampoAlteradoCartaoCnpj[];
  emailsFonesConflito: boolean;
  // Snapshot da Receita mudou de conteúdo (ignorando a data da busca, que
  // é sempre nova) — separado de `alterados` pra não marcar toda empresa
  // como "alterada" só porque foi consultada de novo.
  snapshotMudou: boolean;
}

const FONTE_FEDERAL = 'Receita Federal · BrasilAPI';

function normalizado(valor: string | null | undefined): string {
  return (valor ?? '').trim();
}

// true se `a` é subconjunto de `b` (ignorando espaço/caixa) — usado pra
// decidir se dá pra gravar o array da Receita sem apagar dado que já
// existia e a Receita não devolveu.
function ehSubconjunto(a: string[], b: string[]): boolean {
  const setB = new Set(b.map((v) => v.trim().toLowerCase()));
  return a.every((v) => setB.has(v.trim().toLowerCase()));
}

export function montarSnapshotCartaoCnpj(
  lookup: CnpjLookupResult,
  buscadoEm: Date,
): CartaoCnpjSnapshot {
  return {
    situacaoCadastral: lookup.situacaoCadastral ?? null,
    dataAbertura: lookup.dataAbertura ?? null,
    porte: lookup.porte ?? null,
    naturezaJuridica: lookup.naturezaJuridica ?? null,
    cnaePrincipal: lookup.cnaePrincipal ?? null,
    cnaeSecundarios: lookup.cnaeSecundarios ?? [],
    estabelecimento: lookup.estabelecimento ?? null,
    telefoneReceita: lookup.fones[0] ?? null,
    emailReceita: lookup.emails[0] ?? null,
    fonteFederal: FONTE_FEDERAL,
    buscadoEm: buscadoEm.toISOString(),
  };
}

export function montarAtualizacaoCartaoCnpj(
  company: CompanyParaCartaoCnpj,
  lookup: CnpjLookupResult,
  buscadoEm: Date,
): AtualizacaoCartaoCnpj {
  const alterados: CampoAlteradoCartaoCnpj[] = [];
  const dtoCampos: Partial<UpdateCompanyDto> = {};
  // Alias sem tipo forte só pra permitir atribuição dinâmica por nome de
  // campo no loop abaixo — `dtoCampos` continua tipado no retorno.
  const dtoCamposLivre = dtoCampos as Record<string, unknown>;

  const simples: Array<
    [
      keyof CompanyParaCartaoCnpj & keyof UpdateCompanyDto,
      keyof CnpjLookupResult,
    ]
  > = [
    ['razaoSocial', 'razaoSocial'],
    ['fantasia', 'fantasia'],
    ['logradouro', 'logradouro'],
    ['numero', 'numero'],
    ['complemento', 'complemento'],
    ['bairro', 'bairro'],
    ['cep', 'cep'],
    ['cidade', 'cidade'],
    ['uf', 'uf'],
  ];
  for (const [campoCompany, campoLookup] of simples) {
    const novo = lookup[campoLookup] as string | undefined;
    if (novo === undefined) continue; // Receita não devolveu — não mexe
    const atual = normalizado(company[campoCompany] as string | null);
    if (normalizado(novo) !== atual) {
      alterados.push({ campo: campoCompany, de: atual || null, para: novo });
      dtoCamposLivre[campoCompany] = novo;
    }
  }

  if (company.emRecuperacaoJudicial !== lookup.emRecuperacaoJudicial) {
    alterados.push({
      campo: 'emRecuperacaoJudicial',
      de: company.emRecuperacaoJudicial,
      para: lookup.emRecuperacaoJudicial,
    });
    dtoCamposLivre.emRecuperacaoJudicial = lookup.emRecuperacaoJudicial;
  }

  if (company.tipo !== 'PJ') {
    alterados.push({ campo: 'tipo', de: company.tipo, para: 'PJ' });
    dtoCamposLivre.tipo = 'PJ';
  }

  const cpfCnpjAtual = normalizado(company.cpfCnpj).replace(/\D/g, '');
  if (cpfCnpjAtual !== lookup.cpfCnpj) {
    alterados.push({
      campo: 'cpfCnpj',
      de: company.cpfCnpj,
      para: lookup.cpfCnpj,
    });
    dtoCamposLivre.cpfCnpj = lookup.cpfCnpj;
  }

  // emails/fones — só grava se não apagar dado manual (ver cabeçalho).
  let emailsFonesConflito = false;
  for (const [campo, novo] of [
    ['emails', lookup.emails] as const,
    ['fones', lookup.fones] as const,
  ]) {
    const atual = company[campo] ?? [];
    if (novo.length === 0) continue; // Receita não devolveu nada — não mexe
    const mesmoConjunto =
      atual.length === novo.length &&
      ehSubconjunto(atual, novo) &&
      ehSubconjunto(novo, atual);
    if (mesmoConjunto) continue;
    if (ehSubconjunto(atual, novo)) {
      // atual é subconjunto do da Receita (inclui o caso atual=[]) — pode
      // gravar o conjunto da Receita sem perder nada.
      alterados.push({ campo, de: atual, para: novo });
      dtoCamposLivre[campo] = novo;
    } else {
      // Tem dado no CRM que a Receita não devolveu — não sobrescreve,
      // só reporta pra revisão manual.
      emailsFonesConflito = true;
    }
  }

  const customFieldsAtuais =
    (company.customFields as Record<string, unknown> | null) ?? {};
  const snapshotAtual = customFieldsAtuais.cnpj_lookup as
    Record<string, unknown> | undefined;
  const snapshot = montarSnapshotCartaoCnpj(lookup, buscadoEm);
  const snapshotMudou =
    JSON.stringify({ ...snapshot, buscadoEm: undefined }) !==
    JSON.stringify(
      snapshotAtual
        ? {
            ...snapshotAtual,
            buscadoEm: undefined,
            fonteFederal: snapshot.fonteFederal,
          }
        : undefined,
    );

  return {
    dto: {
      ...dtoCampos,
      customFields: { ...customFieldsAtuais, cnpj_lookup: snapshot },
    },
    alterados,
    emailsFonesConflito,
    snapshotMudou,
  };
}
