// Script ad-hoc (pedido do usuário, 2026-08-13): sanitiza em lote os
// cadastros de Company com base no Cartão CNPJ da Receita Federal (mesma
// fonte da aba "Dados cadastrais" da ficha — BrasilAPI, ver
// CompanyService#lookupCnpj). Faz, pra cada empresa com CNPJ válido, o
// equivalente em lote ao botão "Buscar dados" que hoje só existe um
// registro por vez (web/app/dashboard/empresas/actions.ts
// refreshCnpjDataAction) — fazer isso manualmente empresa por empresa
// levaria dias.
//
// Fora do escopo por pedido explícito do usuário: NÃO mexe no eGestor
// (só na tabela `companies` deste CRM/Supabase) e NÃO mexe nos campos
// estaduais/SEFAZ (inscrição estadual, contribuinte ICMS, situação
// cadastral estadual) — não existe API unificada de SEFAZ, esses campos
// continuam manuais (ver comentário de updateCustomFieldsAction).
//
// Sempre roda em modo SIMULAÇÃO por padrão — só imprime o que mudaria.
// Só grava de verdade com --apply explícito.
//
//   node_modules\.bin\ts-node scripts/sanitizar-cadastros-cnpj.ts                     # dry-run
//   node_modules\.bin\ts-node scripts/sanitizar-cadastros-cnpj.ts --csv=saida.csv     # dry-run, exporta CSV
//   node_modules\.bin\ts-node scripts/sanitizar-cadastros-cnpj.ts --limit=5           # dry-run só nas 5 primeiras (teste)
//   node_modules\.bin\ts-node scripts/sanitizar-cadastros-cnpj.ts --apply             # grava de verdade
//   node_modules\.bin\ts-node scripts/sanitizar-cadastros-cnpj.ts --sem-ficha --apply # só as que nunca foram consultadas na Receita
//
// Decisões de segurança de dado tomadas aqui (evitar perda de dado real
// coletado manualmente pela equipe, que o Cartão CNPJ não tem como saber
// que existe):
//   - emails/fones: só GRAVA quando a Receita devolve pelo menos um valor
//     E o conjunto atual está vazio ou é subconjunto do que a Receita tem
//     (nunca APAGA e-mail/telefone que já está cadastrado e a Receita não
//     conhece — comum quando o vendedor já anotou o contato de verdade).
//     Quando a Receita diverge do que já existe (nenhum é subconjunto do
//     outro), fica de fora e é reportado à parte pra revisão manual.
//   - Demais campos (razão social, fantasia, endereço, situação
//     cadastral, CNAE, porte, natureza jurídica, recuperação judicial):
//     sempre atualiza pro valor da Receita quando vier preenchido e for
//     diferente do atual — é exatamente esse o objetivo do pedido
//     ("sanitizar em relação ao Cartão CNPJ").
//   - CNPJ com 11 dígitos (CPF, pessoa física) ou fora do padrão fica de
//     fora — BrasilAPI cnpj/v1 só serve CNPJ.
//   - Company com tag "lead-triagem" (ainda não aprovada, não aparece no
//     menu Empresas) fica de fora — mesmo filtro que findAll() usa.
//
// Throttle de 500ms entre requisições — BrasilAPI é gratuita/pública, sem
// limite documentado, mas o histórico do projeto já viu 403 de proteção
// anti-bot (ver comentário em company.service.ts#lookupCnpj); manter
// devagar evita 429/bloqueio no meio do lote. Erro de rede/HTTP em uma
// empresa não derruba o lote inteiro — loga e segue pra próxima.

import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { Company } from '@prisma/client';
import { AppModule } from '../src/app.module';
// Regra de merge "Receita → Company" (comparação campo a campo + snapshot
// da aba "Dados cadastrais") mora em src/companies/cartao-cnpj.ts desde
// 2026-08-19 — nasceu aqui, foi extraída pra lá quando a integração do
// eGestor passou a precisar dela também (empresa que entra sozinha pelo
// ERP nascia sem a ficha da Receita). Uma implementação só, três chamadores:
// este script, o botão "Buscar dados" da ficha e o webhook do eGestor.
import { montarAtualizacaoCartaoCnpj } from '../src/companies/cartao-cnpj';
import type { CampoAlteradoCartaoCnpj } from '../src/companies/cartao-cnpj';
import { CompanyService } from '../src/companies/company.service';
import type { CnpjLookupResult } from '../src/companies/company.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';

const WORKSPACE_SLUG = 'gama';
const CSV_ARG = process.argv.find((arg) => arg.startsWith('--csv='));
const CSV_PATH = CSV_ARG ? CSV_ARG.slice('--csv='.length) : undefined;
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.slice('--limit='.length)) : undefined;
// `--csv` é sempre só leitura, mesmo se alguém colar `--apply` junto por
// engano — nunca combina export com escrita no mesmo comando.
const APLICAR = process.argv.includes('--apply') && !CSV_PATH;
// Só as empresas que ainda não têm a ficha da Receita (customFields.
// cnpj_lookup) — ver comentário no filtro dentro de main().
const SOMENTE_SEM_FICHA = process.argv.includes('--sem-ficha');
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

function normalizado(valor: string | null | undefined): string {
  return (valor ?? '').trim();
}

interface Resultado {
  company: Company;
  lookup: CnpjLookupResult | null;
  alterados: CampoAlteradoCartaoCnpj[];
  emailsFonesConflito: boolean;
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
  const ctx = { userId: owner.userId, workspaceId: workspace.id, role: owner.role };

  const todas = await tenantContext.run(ctx, (tx) =>
    tx.company.findMany({
      where: {
        workspaceId: workspace.id,
        deletedAt: null,
        cpfCnpj: { not: null },
        NOT: { tags: { has: 'lead-triagem' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  );

  const comCnpjValido = todas.filter(
    (c) => normalizado(c.cpfCnpj).replace(/\D/g, '').length === 14,
  );
  // `--sem-ficha`: só as que nunca foram consultadas na Receita (aba
  // "Dados cadastrais" vazia). Backfill barato pras empresas que entraram
  // pelo eGestor antes do preenchimento automático existir (2026-08-19) —
  // sem revisitar as centenas já sanitizadas.
  const candidatas = SOMENTE_SEM_FICHA
    ? comCnpjValido.filter(
        (c) => !(c.customFields as Record<string, unknown> | null)?.cnpj_lookup,
      )
    : comCnpjValido;
  const foraDoEscopo = todas.length - comCnpjValido.length;
  const jaTinhamFicha = comCnpjValido.length - candidatas.length;
  const lista = LIMIT ? candidatas.slice(0, LIMIT) : candidatas;

  console.log(
    `${todas.length} empresa(s) com CNPJ preenchido (fora tag lead-triagem). ` +
      `${foraDoEscopo} fora do escopo (CNPJ não tem 14 dígitos — provável CPF/dado incompleto). ` +
      `${SOMENTE_SEM_FICHA ? `${jaTinhamFicha} já tinham a ficha da Receita e foram puladas (--sem-ficha). ` : ''}` +
      `${lista.length} candidata(s) processada(s) nesta rodada. Modo: ${
        CSV_PATH
          ? `EXPORT CSV (só leitura) → ${CSV_PATH}`
          : APLICAR
            ? 'APLICAR (grava no Supabase de produção)'
            : 'SIMULAÇÃO (dry-run, nada é gravado)'
      }\n`,
  );

  const resultados: Resultado[] = [];
  let naoEncontradas = 0;
  let erros = 0;

  for (const [i, company] of lista.entries()) {
    const digits = normalizado(company.cpfCnpj).replace(/\D/g, '');
    const nomeAtual = company.razaoSocial || company.fantasia || '(sem nome)';
    process.stdout.write(`[${i + 1}/${lista.length}] ${digits} — ${nomeAtual} ... `);

    let lookup: CnpjLookupResult | null = null;
    let erro: string | null = null;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        lookup = await companies.lookupCnpj(digits);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('não encontrado')) {
          erro = 'CNPJ não encontrado na Receita';
          naoEncontradas++;
          break;
        }
        if (tentativa === 3) {
          erro = msg;
          erros++;
        } else {
          await sleep(1000 * tentativa); // backoff antes de tentar de novo
        }
      }
    }

    if (!lookup) {
      console.log(`✗ ${erro}`);
      resultados.push({ company, lookup: null, alterados: [], emailsFonesConflito: false, erro });
      await sleep(DELAY_MS);
      continue;
    }

    // Merge compartilhado (src/companies/cartao-cnpj.ts) — já devolve o
    // DTO pronto com os campos divergentes + o snapshot da aba "Dados
    // cadastrais" mesclado ao customFields atual. `snapshotMudou` ignora a
    // data da busca (sempre nova) pra não marcar toda empresa como
    // "alterada" só porque foi consultada de novo.
    const { dto, alterados, emailsFonesConflito, snapshotMudou } =
      montarAtualizacaoCartaoCnpj(company, lookup, new Date());

    if (alterados.length === 0 && !snapshotMudou) {
      console.log('sem mudanças');
    } else {
      console.log(
        `${alterados.length} campo(s) diferente(s)${emailsFonesConflito ? ' (+ email/fone em conflito, não gravado)' : ''}`,
      );
    }

    resultados.push({ company, lookup, alterados, emailsFonesConflito, erro: null });

    if (APLICAR && (alterados.length > 0 || snapshotMudou)) {
      try {
        await tenantContext.run(ctx, (tx) =>
          companies.update(tx, owner, company.id, dto),
        );
        console.log('  ✓ gravado');
      } catch (err) {
        erros++;
        console.error(`  ✗ erro ao gravar: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await sleep(DELAY_MS);
  }

  if (CSV_PATH) {
    const linhas: string[] = [
      ['company_id', 'cnpj', 'nome_atual', 'campo', 'valor_atual', 'valor_receita'].join(';'),
    ];
    for (const r of resultados) {
      if (r.erro) {
        linhas.push([r.company.id, r.company.cpfCnpj, r.company.razaoSocial ?? '', 'ERRO', '', r.erro].map(csvEscape).join(';'));
        continue;
      }
      for (const alt of r.alterados) {
        linhas.push(
          [r.company.id, r.company.cpfCnpj, r.company.razaoSocial ?? '', alt.campo, alt.de, alt.para]
            .map(csvEscape)
            .join(';'),
        );
      }
      if (r.emailsFonesConflito) {
        linhas.push(
          [r.company.id, r.company.cpfCnpj, r.company.razaoSocial ?? '', 'EMAIL_FONE_CONFLITO', '(revisar manualmente)', '']
            .map(csvEscape)
            .join(';'),
        );
      }
    }
    writeFileSync(CSV_PATH, linhas.join('\n') + '\n', 'utf-8');
    console.log(`\n${linhas.length - 1} linha(s) exportada(s) → ${CSV_PATH} (nenhuma escrita no banco).`);
  }

  const comMudanca = resultados.filter((r) => r.alterados.length > 0).length;
  const semMudanca = resultados.filter((r) => !r.erro && r.alterados.length === 0).length;
  const comConflito = resultados.filter((r) => r.emailsFonesConflito).length;

  console.log(
    `\nResumo: ${lista.length} processada(s) · ${comMudanca} com campo(s) divergente(s) da Receita · ` +
      `${semMudanca} já batiam com a Receita · ${comConflito} com email/fone em conflito (não tocado) · ` +
      `${naoEncontradas} CNPJ não encontrado na Receita · ${erros} erro(s).`,
  );
  if (!APLICAR) {
    console.log('Simulação apenas — rode de novo com --apply pra gravar de verdade no Supabase.');
  }

  await app.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
