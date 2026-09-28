// Script ad-hoc (pedido do usuário, 2026-09-24): confere se todo LEAD
// CONVERTIDO tem o cadastro batendo com o cartão CNPJ da Receita Federal
// — o que na tela do CRM se chama "SEFAZ" (ver CAMPOS_SEFAZ em
// src/integrations/egestor/egestor-contato-correction.service.ts: o
// rótulo é o termo do dia a dia; a fonte é a Receita via BrasilAPI, já
// que SEFAZ é estadual e não tem API unificada de dado cadastral).
//
// SÓ LEITURA. Não grava nada, em nenhuma circunstância — não existe
// `--apply` aqui de propósito. Para corrigir de fato, o caminho é o
// botão "Buscar dados" da ficha ou scripts/sanitizar-cadastros-cnpj.ts.
//
//   node_modules\.bin\ts-node scripts/conferir-cadastro-leads-convertidos.ts
//   node_modules\.bin\ts-node scripts/conferir-cadastro-leads-convertidos.ts --csv=C:\caminho\saida.csv
//   node_modules\.bin\ts-node scripts/conferir-cadastro-leads-convertidos.ts --limit=5
//
// O CSV tem CNPJ e razão social de empresa real, então NUNCA é gravado
// dentro do repositório: o padrão é a Área de Trabalho de quem roda.
//
// Três situações são reportadas separadamente, porque pedem ações
// diferentes:
//   1. NUNCA CONSULTADO — a empresa não tem a ficha da Receita
//      (customFields.cnpj_lookup). Ninguém apertou "Buscar dados".
//   2. DIVERGENTE — tem ficha, mas algum campo do cadastro está
//      diferente do que a Receita devolve hoje.
//   3. ERRO — a consulta não respondeu (CNPJ inexistente na base da
//      Receita, rede, bloqueio anti-bot). Não é conclusão sobre o
//      cadastro: é "não deu pra conferir".
//
// Throttle de 500ms entre consultas, mesmo motivo de
// sanitizar-cadastros-cnpj.ts (BrasilAPI é pública e o projeto já viu
// 403 de proteção anti-bot).

import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { Company, RawLead } from '@prisma/client';
import { montarAtualizacaoCartaoCnpj } from '../src/companies/cartao-cnpj';
import type { CampoAlteradoCartaoCnpj } from '../src/companies/cartao-cnpj';
import { CompanyService } from '../src/companies/company.service';
import type { CnpjLookupResult } from '../src/companies/company.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import { AppModule } from '../src/app.module';

const WORKSPACE_SLUG = 'gama';
const CSV_ARG = process.argv.find((arg) => arg.startsWith('--csv='));
const CSV_PATH = CSV_ARG ? CSV_ARG.slice('--csv='.length) : undefined;
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.slice('--limit='.length)) : undefined;
const DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvEscape(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = Array.isArray(valor) ? JSON.stringify(valor) : String(valor);
  if (/[",\n;]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

type Situacao = 'ok' | 'divergente' | 'nunca_consultado' | 'erro';

interface Linha {
  lead: RawLead;
  company: Company;
  situacao: Situacao;
  temFicha: boolean;
  divergencias: CampoAlteradoCartaoCnpj[];
  situacaoCadastral: string | null;
  erro: string | null;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const tenantContext = app.get(TenantContextService);
  const companies = app.get(CompanyService);

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { slug: WORKSPACE_SLUG },
  });
  const owner = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_workspace_id = '${workspace.id}'`,
    );
    return tx.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id, role: 'owner' },
    });
  });
  const ctx = {
    userId: owner.userId,
    workspaceId: workspace.id,
    role: owner.role,
  };

  const leads = await tenantContext.run(ctx, (tx) =>
    tx.rawLead.findMany({
      where: { workspaceId: workspace.id, status: 'aprovado' },
      orderBy: { razaoSocial: 'asc' },
    }),
  );
  const empresas = await tenantContext.run(ctx, (tx) =>
    tx.company.findMany({
      where: {
        workspaceId: workspace.id,
        id: {
          in: leads
            .map((l) => l.promotedCompanyId)
            .filter((id): id is string => Boolean(id)),
        },
      },
    }),
  );
  const empresaPorId = new Map(empresas.map((c) => [c.id, c]));

  const alvo = LIMIT ? leads.slice(0, LIMIT) : leads;
  console.log(
    `Leads convertidos: ${leads.length}${LIMIT ? ` (conferindo os ${alvo.length} primeiros)` : ''}\n`,
  );

  const linhas: Linha[] = [];
  const semEmpresa: RawLead[] = [];

  for (const [i, lead] of alvo.entries()) {
    const company = lead.promotedCompanyId
      ? empresaPorId.get(lead.promotedCompanyId)
      : undefined;
    if (!company) {
      semEmpresa.push(lead);
      continue;
    }

    const custom = (company.customFields ?? {}) as Record<string, unknown>;
    const temFicha = Object.prototype.hasOwnProperty.call(
      custom,
      'cnpj_lookup',
    );
    const digitos = (company.cpfCnpj ?? '').replace(/\D/g, '');

    process.stdout.write(`[${i + 1}/${alvo.length}] conferindo… `);

    if (digitos.length !== 14) {
      linhas.push({
        lead,
        company,
        situacao: 'erro',
        temFicha,
        divergencias: [],
        situacaoCadastral: null,
        erro: 'CNPJ ausente ou fora do padrão de 14 dígitos',
      });
      console.log('sem CNPJ válido');
      continue;
    }

    let lookup: CnpjLookupResult;
    try {
      lookup = await companies.lookupCnpj(digitos);
    } catch (error) {
      linhas.push({
        lead,
        company,
        situacao: 'erro',
        temFicha,
        divergencias: [],
        situacaoCadastral: null,
        erro: error instanceof Error ? error.message : String(error),
      });
      console.log('falhou');
      await sleep(DELAY_MS);
      continue;
    }

    // Mesma régua do botão "Buscar dados" da ficha: o que ela GRAVARIA é
    // exatamente o que está divergente hoje.
    const { alterados } = montarAtualizacaoCartaoCnpj(
      company,
      lookup,
      new Date(),
    );
    const situacao: Situacao = !temFicha
      ? 'nunca_consultado'
      : alterados.length > 0
        ? 'divergente'
        : 'ok';

    linhas.push({
      lead,
      company,
      situacao,
      temFicha,
      divergencias: alterados,
      situacaoCadastral: lookup.situacaoCadastral ?? null,
      erro: null,
    });
    console.log(
      situacao === 'ok'
        ? 'ok'
        : situacao === 'nunca_consultado'
          ? `nunca consultado (${alterados.length} campo(s) a preencher)`
          : `${alterados.length} campo(s) divergente(s)`,
    );
    await sleep(DELAY_MS);
  }

  const por = (s: Situacao) => linhas.filter((l) => l.situacao === s);
  const naoAtivas = linhas.filter(
    (l) => l.situacaoCadastral && l.situacaoCadastral !== 'ATIVA',
  );

  console.log('\n──────── RESUMO ────────');
  console.log(`Conferidos:            ${linhas.length}`);
  console.log(`Batendo com a Receita: ${por('ok').length}`);
  console.log(`Nunca consultados:     ${por('nunca_consultado').length}`);
  console.log(`Com divergência:       ${por('divergente').length}`);
  console.log(`Não deu pra conferir:  ${por('erro').length}`);
  if (semEmpresa.length > 0) {
    console.log(`Lead sem empresa:      ${semEmpresa.length}`);
  }
  if (naoAtivas.length > 0) {
    console.log(
      `\nAtenção — situação cadastral diferente de ATIVA: ${naoAtivas.length}`,
    );
  }

  // Quais campos mais divergem: diz se é problema de cadastro (endereço
  // desatualizado) ou de coisa que nunca foi preenchida.
  const porCampo = new Map<string, number>();
  for (const l of linhas) {
    for (const d of l.divergencias) {
      porCampo.set(d.campo, (porCampo.get(d.campo) ?? 0) + 1);
    }
  }
  if (porCampo.size > 0) {
    console.log('\nCampos que não batem (quantos cadastros cada um):');
    for (const [campo, n] of [...porCampo.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${campo.padEnd(22)} ${n}`);
    }
  }

  if (CSV_PATH) {
    const cabecalho = [
      'situacao',
      'razao_social_crm',
      'cnpj',
      'tem_ficha_receita',
      'situacao_cadastral_receita',
      'campos_divergentes',
      'detalhe',
      'erro',
    ];
    const linhasCsv = linhas.map((l) =>
      [
        l.situacao,
        l.company.razaoSocial ?? l.lead.razaoSocial,
        l.company.cpfCnpj,
        l.temFicha ? 'sim' : 'nao',
        l.situacaoCadastral,
        l.divergencias.map((d) => d.campo).join(' | '),
        l.divergencias
          .map((d) => `${d.campo}: "${String(d.de ?? '')}" → "${String(d.para ?? '')}"`)
          .join(' | '),
        l.erro,
      ]
        .map(csvEscape)
        .join(','),
    );
    writeFileSync(
      CSV_PATH,
      [cabecalho.join(','), ...linhasCsv].join('\n'),
      'utf8',
    );
    console.log(`\nCSV gravado em ${CSV_PATH}`);
  }

  await app.close();
}

void main();
