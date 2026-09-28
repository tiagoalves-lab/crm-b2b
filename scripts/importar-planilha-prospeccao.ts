// Script ad-hoc (pedido do usuário, 2026-09-23): importa para a
// Prospecção a planilha de ligações que a equipe mantém à mão há anos
// ("EMPRESAS GERAL BRASIL", uma aba por bloco de cidades), onde cada empresa
// ocupa um bloco de linhas: a primeira traz o cadastro, as seguintes
// trazem os demais contatos e o histórico de conversa. Nenhum caminho de
// importação existente dá conta desse formato — o modelo padrão da tela
// exige CNPJ em toda linha (metade da planilha não tem), não tem onde
// colocar telefone/e-mail/endereço da empresa e não escreve nada na
// Timeline.
//
// O arquivo com dado real NUNCA entra no repositório (docs/seguranca.md):
// o caminho vem por parâmetro e o CSV fica fora do projeto.
//
//   node_modules\.bin\ts-node scripts/importar-planilha-prospeccao.ts --arquivo="C:\caminho\planilha.csv"
//                                                                    # diagnóstico (não grava nada)
//   ... --arquivo=... --representante="Nome do membro" --apply       # grava de verdade
//   ... --origem="Serra Gaúcha"                                      # nome da aba, vira tag de origem
//   ... --uf=SC                                                      # estado das empresas da aba (default RS)
//   ... --incluir-nao-atender                                        # traz também as cidades marcadas "(não atender)"
//   ... --limite=10                                                  # só as 10 primeiras (teste)
//
// O que entra:
//   - Empresa na Prospecção (razão social, cidade/UF, CNPJ quando tem,
//     endereço, telefones e e-mails gerais, porte) + lead de triagem.
//   - Um contato por pessoa nomeada na planilha (nome, cargo quando vem
//     depois do "-", e-mail e telefone).
//   - Uma anotação na Timeline com o histórico de conversa (coluna OBS) e
//     as datas de último contato.
//
// O que fica de fora, por decisão: as colunas à direita do CNPJ na
// planilha (contatos antigos marcados "saiu da empresa", "erro e-mail",
// telefone que não existe mais) — é histórico já descartado pela própria
// equipe, entraria no CRM como lixo.

import { readFileSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ContactService } from '../src/companies/contact.service';
import { ActivityService } from '../src/activities/activity.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RawLeadService } from '../src/raw-leads/raw-lead.service';
import { resolverRepresentante } from '../src/raw-leads/representante-planilha';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import type { MembershipContext } from '../src/tenancy/tenant-membership.guard';

const WORKSPACE_SLUG = 'gama';

const args = process.argv.slice(2);
const arg = (nome: string): string | undefined =>
  args.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=');
const APLICAR = args.includes('--apply');
const ARQUIVO = arg('arquivo');
const LIMITE = Number(arg('limite') ?? 0);
const REPRESENTANTE = arg('representante');
// Alternativa ao nome: rodando fora do servidor, o nome do membro não é
// resolvível (ele vive no Supabase Auth e a chave de administrador só
// existe no backend em produção, nunca na máquina de quem roda o script).
// Nesse caso passa-se o id do membro direto.
const REPRESENTANTE_ID = arg('representante-id');
const PREVIA = arg('previa');
// A planilha separa por região e cidade, mas não tem coluna de estado: a
// aba é que diz de onde são as empresas. Default RS (as abas gaúchas);
// as de SC/PR/SP/MG precisam passar --uf.
const UF = (arg('uf') ?? 'RS').toUpperCase();
// Cidade que a planilha marca como "(não atender)" fica de fora por
// padrão; com esta opção entra marcada com a tag "Não atender", pra
// servir de consulta sem se misturar com a rotina de ligação.
const INCLUIR_NAO_ATENDER = args.includes('--incluir-nao-atender');

// Marca de origem: é ela que torna o script re-executável sem duplicar
// nada. Empresa sem CNPJ não tem como ser deduplicada pela regra normal
// do CRM (que casa por CNPJ), então o par "tem uma tag de origem + mesmo
// nome na mesma cidade" faz esse papel — importante porque são milhares
// de empresas, o lote pode precisar ser retomado no meio, e a mesma
// empresa às vezes aparece em duas abas da planilha.
const PREFIXO_TAG_ORIGEM = 'Planilha ';
const TAG_ORIGEM = `${PREFIXO_TAG_ORIGEM}${arg('origem') ?? 'interior RS'}`;
const PREFIXO_ANOTACAO = 'Histórico da planilha de prospecção';

// ─────────────────────────── leitura do CSV ───────────────────────────
// Parser próprio (2 linhas) em vez de dependência nova: o arquivo é um
// CSV exportado do Google Sheets, só precisa respeitar aspas.
function parseCsv(text: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (aspas) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n') {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

// As abas não são iguais: Minas Gerais não tem a primeira coluna vazia
// (tudo desloca uma casa à esquerda), Joinville tem uma coluna a mais no
// endereço e a do Paraná nem tem CEP. Por isso as colunas são descobertas
// pelo nome no cabeçalho, nunca por posição fixa — posição fixa já
// colocaria CNPJ no lugar de bairro em duas das sete abas.
type Campo =
  | 'regiao'
  | 'cidade'
  | 'empresa'
  | 'porte'
  | 'telefone'
  | 'email'
  | 'contato'
  | 'obs'
  | 'dataRetorno'
  | 'dataGama'
  | 'rua'
  | 'numero'
  | 'bairro'
  | 'cep'
  | 'cnpj';

const NOMES_DE_COLUNA: Record<Campo, string[]> = {
  regiao: ['regiao'],
  cidade: ['cidade'],
  empresa: ['nomeempresa'],
  porte: ['porteclassif'],
  telefone: ['telefone'],
  email: ['email'],
  contato: ['contato'],
  obs: ['obs'],
  dataRetorno: ['retornodocliente'],
  dataGama: ['gama'],
  rua: ['rua'],
  numero: ['n', 'no', 'numero'],
  bairro: ['bairro'],
  cep: ['cep'],
  cnpj: ['cnpj'],
};

type MapaDeColunas = Partial<Record<Campo, number>>;

function normalizarTitulo(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Endereço (Rua/Nº/Bairro/CEP/CNPJ) mora numa faixa própria, escrita uma
// linha ACIMA do cabeçalho principal — por isso as duas linhas são lidas,
// com a do cabeçalho tendo preferência.
export function mapearColunas(linhas: string[][]): {
  colunas: MapaDeColunas;
  primeiraLinha: number;
} {
  const iCabecalho = linhas.findIndex((l) =>
    l.some((c) => normalizarTitulo(txt(c)) === 'nomeempresa'),
  );
  if (iCabecalho < 0) {
    throw new Error(
      'Não achei a linha de cabeçalho (nenhuma célula escrita "Nome Empresa").',
    );
  }

  const colunas: MapaDeColunas = {};
  const aplicar = (linha: string[] | undefined) => {
    linha?.forEach((celula, i) => {
      const titulo = normalizarTitulo(txt(celula));
      if (!titulo) return;
      for (const [campo, nomes] of Object.entries(NOMES_DE_COLUNA) as Array<
        [Campo, string[]]
      >) {
        if (colunas[campo] === undefined && nomes.includes(titulo)) {
          colunas[campo] = i;
        }
      }
    });
  };
  aplicar(linhas[iCabecalho]);
  aplicar(linhas[iCabecalho - 1]);

  for (const obrigatoria of ['empresa', 'cidade', 'contato'] as Campo[]) {
    if (colunas[obrigatoria] === undefined) {
      throw new Error(
        `Cabeçalho sem a coluna "${obrigatoria}" — confira se a aba segue o layout das outras.`,
      );
    }
  }

  return { colunas, primeiraLinha: iCabecalho + 1 };
}

export interface ContatoPlanilha {
  nome: string;
  cargo?: string;
  email?: string;
  telefone?: string;
}

export interface EmpresaPlanilha {
  linha: number;
  razaoSocial: string;
  regiao: string;
  cidade: string;
  // A própria planilha marca cidades que a Gama não atende — quem decide
  // o que fazer com elas é quem roda o script (--nao-atender).
  naoAtender: boolean;
  porte?: string;
  classificacao?: string;
  cnpj?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  fones: string[];
  emails: string[];
  contatos: ContatoPlanilha[];
  historico: string[];
  ultimoContato?: string;
}

const txt = (v: unknown): string => String(v ?? '').trim();
const digitos = (v: string): string => v.replace(/\D/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "G/B" = porte (Grande/Médio/Pequeno) + classificação de potencial
// (A/B/C), conforme a legenda da própria planilha.
const PORTE_POR_LETRA: Record<string, string> = {
  G: 'GRANDE',
  M: 'MÉDIO',
  P: 'PEQUENO',
};

// Nem toda aba escreve a data do mesmo jeito: a maioria usa 21/07/2025,
// mas algumas (Grande Porto Alegre) vieram no padrão americano
// (7/21/2025), porque a planilha viveu anos em contas diferentes. Quem
// decide é o valor: dia acima de 12 só pode ser dia. Sem pista, vale o
// padrão brasileiro.
export function dataParaIso(bruta: string): string | null {
  const m = bruta.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let dia = Number(m[1]);
  let mes = Number(m[2]);
  if (mes > 12 && dia <= 12) [dia, mes] = [mes, dia];
  if (dia > 31 || mes > 12 || dia === 0 || mes === 0) return null;
  const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Cidade vem com o recado da equipe junto ("Porto Alegre (não atender)").
// O recado é lido à parte (ver cidadeProibida); no cadastro entra só o
// nome da cidade.
export function limparCidade(valor: string): string {
  return valor.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

export function cidadeProibida(valor: string): boolean {
  return /não\s*atender/i.test(valor);
}

// Nome solto no fim da aba, sem telefone, e-mail, contato, CNPJ,
// endereço nem histórico: é lembrete da equipe ("olhar essa empresa"),
// não um prospect. Vira cadastro vazio no CRM e ninguém tem o que fazer
// com ele.
export function temAlgoParaTrabalhar(e: EmpresaPlanilha): boolean {
  return Boolean(
    e.contatos.length ||
      e.fones.length ||
      e.emails.length ||
      e.cnpj ||
      e.logradouro ||
      e.historico.length,
  );
}

// Linha da coluna "Nome Empresa" que na verdade é texto de anotação que
// escorregou de célula (acontece algumas vezes na planilha) — não vira
// empresa.
function pareceAnotacao(nome: string): boolean {
  return (
    nome.length > 90 ||
    /^(whats|falei|enviar|perguntei|não ligar|sem demanda)/i.test(nome)
  );
}

export function lerPlanilha(caminho: string): EmpresaPlanilha[] {
  const linhas = parseCsv(readFileSync(caminho, 'utf8'));

  // O corpo da aba termina onde começa o rodapé de estatísticas (a tabela
  // "Cidade Base / Região Base / Total Empresas"): dali pra baixo é
  // legenda, contagem e rascunho. Aba sem esse rodapé cai no fechamento
  // de região ("região J 40 emp"); sem nenhum dos dois, vai até o fim.
  //
  // Não dá pra usar só o fechamento de região: em abas como a do Oeste
  // catarinense ele aparece no meio (uma vez por região) e cidades de
  // verdade vêm depois da última ocorrência.
  const { colunas, primeiraLinha: cabecalho } = mapearColunas(linhas);
  const col = (l: string[], campo: Campo): string =>
    colunas[campo] === undefined ? '' : txt(l[colunas[campo]!]);
  let fim = linhas.length;
  const rodape = linhas.findIndex(
    (l, i) =>
      i > cabecalho && l.some((c) => txt(c).toLowerCase() === 'cidade base'),
  );
  if (rodape > 0) {
    fim = rodape;
  } else {
    for (let i = linhas.length - 1; i >= cabecalho; i--) {
      if (/^região\s+\w+\s+\d+/i.test(col(linhas[i], 'regiao'))) {
        fim = i;
        break;
      }
    }
  }

  const empresas: EmpresaPlanilha[] = [];
  let atual: EmpresaPlanilha | null = null;
  let cidade = '';
  let naoAtender = false;
  let regiao = '';

  for (let i = cabecalho; i < fim; i++) {
    const l = linhas[i];
    const r = col(l, 'regiao');
    if (r && !/^região/i.test(r)) regiao = r;
    const c = col(l, 'cidade');
    if (c) {
      cidade = limparCidade(c);
      naoAtender = cidadeProibida(c);
    }

    const nome = col(l, 'empresa');
    if (nome && !pareceAnotacao(nome)) {
      const porteBruto = col(l, 'porte').toUpperCase();
      const [porteLetra, classificacao] = porteBruto.split('/');
      const cnpj = digitos(col(l, 'cnpj'));
      atual = {
        linha: i + 1,
        razaoSocial: nome,
        regiao,
        cidade,
        naoAtender,
        porte: PORTE_POR_LETRA[txt(porteLetra)] ?? undefined,
        classificacao: txt(classificacao) || undefined,
        cnpj: cnpj.length === 14 ? cnpj : undefined,
        logradouro: col(l, 'rua') || undefined,
        numero: col(l, 'numero') || undefined,
        bairro: col(l, 'bairro') || undefined,
        cep: digitos(col(l, 'cep')) || undefined,
        fones: [],
        emails: [],
        contatos: [],
        historico: [],
      };
      empresas.push(atual);
    }
    if (!atual) continue;

    const obs = col(l, 'obs');
    if (obs) atual.historico.push(obs);

    // Datas: "Retorno do cliente" e "GAMA" (último contato feito pela
    // equipe). Guarda a mais recente só para o texto da anotação.
    for (const bruta of [
      col(l, 'dataRetorno'),
      col(l, 'dataGama'),
    ]) {
      const iso = dataParaIso(bruta);
      if (iso && (!atual.ultimoContato || iso > atual.ultimoContato)) {
        atual.ultimoContato = iso;
      }
    }

    const nomeContato = col(l, 'contato');
    const email = col(l, 'email').toLowerCase();
    const fone = digitos(col(l, 'telefone'));
    if (nomeContato) {
      // "Fulano de Tal - diretor" → nome + cargo.
      const [pessoa, ...resto] = nomeContato.split(' - ');
      atual.contatos.push({
        nome: txt(pessoa),
        cargo: resto.length ? resto.join(' - ').trim() : undefined,
        email: EMAIL_RE.test(email) ? email : undefined,
        telefone: fone.length >= 10 ? fone : undefined,
      });
    } else {
      // Linha sem pessoa: telefone/e-mail geral da empresa.
      if (fone.length >= 10 && !atual.fones.includes(fone)) {
        atual.fones.push(fone);
      }
      if (EMAIL_RE.test(email) && !atual.emails.includes(email)) {
        atual.emails.push(email);
      }
    }
  }

  return empresas;
}

// ─────────────────────────── diagnóstico ───────────────────────────
async function main() {
  if (!ARQUIVO) {
    throw new Error(
      'Informe o arquivo: --arquivo="C:\\caminho\\planilha.csv" (o CSV fica fora do repositório).',
    );
  }

  const lidas = lerPlanilha(ARQUIVO);
  const empresas = lidas.filter(temAlgoParaTrabalhar);
  const semNadaParaTrabalhar = lidas.length - empresas.length;
  const foraDeTerritorio = empresas.filter((e) => e.naoAtender).length;
  const noTerritorio = INCLUIR_NAO_ATENDER
    ? empresas
    : empresas.filter((e) => !e.naoAtender);
  const selecionadas =
    LIMITE > 0 ? noTerritorio.slice(0, LIMITE) : noTerritorio;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const tenantContext = app.get(TenantContextService);

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

  const existentes = await tenantContext.run(ctx, (tx) =>
    tx.company.findMany({
      where: { workspaceId: workspace.id, deletedAt: null },
      select: {
        id: true,
        cpfCnpj: true,
        razaoSocial: true,
        fantasia: true,
        cidade: true,
        tags: true,
      },
    }),
  );

  const norm = (s: string | null) =>
    txt(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

  const porCnpj = new Map<string, string>();
  const porNome = new Map<string, string>();
  // Empresa da planilha sem CNPJ, com nome E cidade iguais aos de uma já
  // cadastrada: é a mesma empresa — reaproveita em vez de abrir um
  // segundo cadastro. Exigir a cidade é o que protege dos homônimos
  // reais que o CRM já tem (nome sozinho não basta, e o sistema não tem
  // como fundir dois cadastros depois).
  const porNomeCidade = new Map<string, string>();
  // Só o que este mesmo script já importou antes (tag de origem) entra no
  // índice de retomada — casar por nome com o resto da base seria chute:
  // o CRM tem homônimos reais, já documentado no projeto.
  const jaImportadas = new Map<string, string>();
  for (const c of existentes) {
    const d = digitos(txt(c.cpfCnpj));
    if (d.length === 14 && !porCnpj.has(d)) porCnpj.set(d, c.id);
    for (const n of [c.razaoSocial, c.fantasia]) {
      const k = norm(n);
      if (k && !porNome.has(k)) porNome.set(k, c.id);
      const kc = `${k}|${norm(c.cidade)}`;
      if (k && !porNomeCidade.has(kc)) porNomeCidade.set(kc, c.id);
    }
    if (c.tags.some((t) => t.startsWith(PREFIXO_TAG_ORIGEM))) {
      const k = `${norm(c.razaoSocial)}|${norm(c.cidade)}`;
      if (!jaImportadas.has(k)) jaImportadas.set(k, c.id);
    }
  }
  const chaveOrigem = (e: EmpresaPlanilha) =>
    `${norm(e.razaoSocial)}|${norm(e.cidade)}`;

  let baterCnpj = 0;
  let baterNome = 0;
  let novas = 0;
  for (const e of selecionadas) {
    if (e.cnpj && porCnpj.has(e.cnpj)) baterCnpj++;
    else if (porNome.has(norm(e.razaoSocial))) baterNome++;
    else novas++;
  }

  const contatos = selecionadas.reduce((a, e) => a + e.contatos.length, 0);
  const comHistorico = selecionadas.filter((e) => e.historico.length).length;

  console.log('─── Planilha ───');
  console.log('empresas lidas:            ', selecionadas.length);
  if (semNadaParaTrabalhar) {
    console.log(
      `  (${semNadaParaTrabalhar} ignoradas: só o nome, sem telefone/e-mail/contato)`,
    );
  }
  if (foraDeTerritorio) {
    console.log(
      INCLUIR_NAO_ATENDER
        ? `  (inclui ${foraDeTerritorio} de cidade marcada "não atender")`
        : `  (${foraDeTerritorio} deixadas de fora: cidade marcada "não atender")`,
    );
  }
  console.log('  com CNPJ:                ', selecionadas.filter((e) => e.cnpj).length);
  console.log('  sem CNPJ:                ', selecionadas.filter((e) => !e.cnpj).length);
  console.log('contatos com nome:         ', contatos);
  console.log('empresas com histórico:    ', comHistorico);
  console.log('─── Cruzamento com o CRM ───');
  console.log('empresas no CRM hoje:      ', existentes.length);
  console.log('já existe (mesmo CNPJ):    ', baterCnpj);
  console.log('já existe (mesmo nome):    ', baterNome);
  console.log('entrariam como novas:      ', novas);

  // `--previa=arquivo.txt`: escreve num arquivo FORA do repositório como
  // as primeiras empresas ficariam no CRM (cadastro, contatos e a
  // anotação da Timeline), pra conferência antes de gravar qualquer coisa.
  if (PREVIA) {
    const amostra = selecionadas.slice(0, 15).map((e) => {
      const linhas = [
        `EMPRESA: ${e.razaoSocial}`,
        `  cidade: ${e.cidade}/${UF}   porte: ${e.porte ?? '—'}   classe: ${e.classificacao ?? '—'}`,
        `  CNPJ: ${e.cnpj ?? '(sem CNPJ — entra como lead, só não pode ser aprovada sem preencher)'}`,
        `  endereço: ${[e.logradouro, e.numero, e.bairro, e.cep].filter(Boolean).join(', ') || '—'}`,
        `  telefones: ${e.fones.join(', ') || '—'}`,
        `  e-mails: ${e.emails.join(', ') || '—'}`,
        `  tags: ${montarTags(e, porNome.has(norm(e.razaoSocial))).join(' · ')}`,
        `  CONTATOS (${e.contatos.length}):`,
        ...e.contatos.map(
          (c) =>
            `    - ${c.nome}${c.cargo ? ` (${c.cargo})` : ''} | ${c.email ?? 'sem e-mail'} | ${c.telefone ?? 'sem telefone'}`,
        ),
        '  ANOTAÇÃO NA TIMELINE:',
        ...(montarAnotacao(e) ?? '(sem histórico)')
          .split('\n')
          .map((l) => `    ${l}`),
      ];
      return linhas.join('\n');
    });
    writeFileSync(PREVIA, amostra.join('\n\n' + '─'.repeat(70) + '\n\n'), 'utf8');
    console.log(`\nprévia das 15 primeiras empresas gravada em: ${PREVIA}`);
  }

  if (!APLICAR) {
    console.log('\n(diagnóstico — nada foi gravado; use --apply para importar)');
    await app.close();
    return;
  }

  // ─────────────────────────── gravação ───────────────────────────
  if (!REPRESENTANTE && !REPRESENTANTE_ID) {
    throw new Error(
      '--apply exige --representante="Nome do membro" ou --representante-id=<id> (de quem fica a carteira).',
    );
  }

  const rawLeads = app.get(RawLeadService);
  const contactService = app.get(ContactService);
  const activities = app.get(ActivityService);

  const membership: MembershipContext = {
    id: owner.id,
    workspaceId: workspace.id,
    userId: owner.userId,
    role: owner.role,
    status: owner.status,
    permissions: owner.permissions,
  };

  const membrosAtivos = await tenantContext.run(ctx, (tx) =>
    rawLeads.listarMembrosAtivos(tx, membership),
  );

  let donoUserId: string;
  if (REPRESENTANTE_ID) {
    if (!membrosAtivos.includes(REPRESENTANTE_ID)) {
      throw new Error(
        `--representante-id=${REPRESENTANTE_ID} não é membro ativo deste workspace.`,
      );
    }
    donoUserId = REPRESENTANTE_ID;
  } else {
    const indice = await rawLeads.indexarRepresentantes(membrosAtivos);
    const dono = resolverRepresentante(REPRESENTANTE, indice, {
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!dono.ok) throw new Error(dono.motivo);
    donoUserId = dono.userId;
  }

  let criadas = 0;
  let reaproveitadas = 0;
  let contatosCriados = 0;
  let anotacoes = 0;
  const falhas: Array<{ linha: number; motivo: string }> = [];

  for (const e of selecionadas) {
    try {
      // Uma transação por empresa (empresa + contatos + anotação): o lote
      // inteiro numa transação só estouraria o timeout do Prisma e
      // seguraria uma conexão do pool por minutos — mesmo motivo já
      // documentado no endpoint de importação por planilha.
      await tenantContext.run(
        ctx,
        async (tx) => {
          const jaExisteId =
            (e.cnpj ? porCnpj.get(e.cnpj) : undefined) ??
            jaImportadas.get(chaveOrigem(e)) ??
            (e.cnpj ? undefined : porNomeCidade.get(chaveOrigem(e)));
          let companyId: string;

          if (jaExisteId) {
            // Empresa que já está no CRM (muitas vezes já é cliente pelo
            // eGestor): NÃO volta pra fila de triagem — só recebe os
            // contatos que faltam e o histórico na Timeline.
            companyId = jaExisteId;
            reaproveitadas++;
          } else {
            const lead = await rawLeads.create(
              tx,
              membership,
              {
                razaoSocial: e.razaoSocial,
                cnpj: e.cnpj,
                porte: e.porte,
                uf: UF,
                municipio: e.cidade || undefined,
                // Sem consulta à Receita aqui (metade da planilha nem tem
                // CNPJ): assume ATIVA pelo mesmo motivo da importação por
                // planilha — não faz sentido penalizar o score de todo
                // mundo por um dado que a planilha não carrega.
                situacao: 'ATIVA',
                emails: e.emails.length ? e.emails : undefined,
                fones: e.fones.length ? e.fones : undefined,
                tags: montarTags(e, porNome.has(norm(e.razaoSocial))),
              },
              { semTimeline: true, ownerUserId: donoUserId },
            );
            companyId = lead.promotedCompanyId!;
            criadas++;

            // Endereço não passa pelo CreateRawLeadDto (o cadastro de lead
            // não tem esses campos) e a empresa nasce só com a tag de
            // triagem — os dois são gravados direto na empresa recém-criada.
            // A tag de origem é o que permite retomar o lote sem duplicar.
            await tx.company.update({
              where: { id: companyId },
              data: {
                logradouro: e.logradouro?.toUpperCase(),
                numero: e.numero,
                bairro: e.bairro?.toUpperCase(),
                cep: e.cep,
                tags: ['lead-triagem', TAG_ORIGEM],
              },
            });
          }

          for (const c of e.contatos) {
            const duplicado = await tx.contact.findFirst({
              where: {
                companyId,
                nome: c.nome,
                email: c.email ?? null,
                telefone: c.telefone ?? null,
              },
            });
            if (duplicado) continue;
            await contactService.create(
              tx,
              membership,
              companyId,
              {
                nome: c.nome,
                cargo: c.cargo,
                email: c.email,
                telefone: c.telefone,
                decisor: false,
              },
              donoUserId,
            );
            contatosCriados++;
          }

          const texto = montarAnotacao(e);
          // Retomar o lote não pode escrever o mesmo histórico duas vezes
          // na Timeline.
          const anotacaoJaEscrita = texto
            ? await tx.activity.findFirst({
                where: {
                  companyId,
                  type: 'note',
                  payload: { path: ['texto'], string_starts_with: PREFIXO_ANOTACAO },
                },
              })
            : null;
          if (texto && !anotacaoJaEscrita) {
            await activities.emit(tx, {
              workspaceId: ctx.workspaceId,
              // Autor é o dono da carteira, não quem rodou o script: o
              // histórico é do trabalho dele com a conta.
              actorUserId: donoUserId,
              type: 'note',
              payload: { texto },
              companyId,
            });
            anotacoes++;
          }
        },
        { timeoutMs: 30_000 },
      );
    } catch (erro) {
      falhas.push({
        linha: e.linha,
        motivo: erro instanceof Error ? erro.message : 'erro desconhecido',
      });
    }
  }

  console.log('\n─── Importado ───');
  console.log('empresas novas na Prospecção:', criadas);
  console.log('empresas já existentes usadas:', reaproveitadas);
  console.log('contatos criados:            ', contatosCriados);
  console.log('anotações na Timeline:       ', anotacoes);
  console.log('linhas com falha:            ', falhas.length);
  for (const f of falhas.slice(0, 20)) {
    console.log(`  linha ${f.linha}: ${f.motivo}`);
  }

  await app.close();
}

// Tags de organização na Prospecção: origem, região da planilha e a
// classificação de potencial (a letra depois da barra em "G/B"), gravada
// como está — o que ela significa é régua da equipe, não do CRM.
// `nomeEmOutraCidade`: já existe empresa com este nome no CRM, mas em
// outra cidade — pode ser a mesma (cidade errada em algum dos dois
// cadastros) ou homônima. Entra como cadastro novo e marcada pra
// conferência humana; o script não adivinha.
function montarTags(e: EmpresaPlanilha, nomeEmOutraCidade: boolean): string[] {
  const tags = [TAG_ORIGEM];
  if (e.regiao) tags.push(`Região ${e.regiao}`);
  if (e.classificacao) tags.push(`Classe ${e.classificacao}`);
  // Território que a Gama não atende (a planilha marca na própria
  // cidade): entra pra consulta, marcado, e fica fácil tirar da rotina
  // de ligação por filtro — decisão do usuário, 2026-09-23.
  if (e.naoAtender) tags.push('Não atender');
  if (nomeEmOutraCidade) tags.push('Revisar duplicidade');
  return tags;
}

// Histórico de conversa da planilha vira UMA anotação por empresa — a
// coluna OBS acumulou anos de retorno em texto corrido, e uma anotação
// por linha encheria a Timeline de fragmentos sem data.
function montarAnotacao(e: EmpresaPlanilha): string | null {
  const blocos = [...new Set(e.historico.map((h) => h.trim()))].filter(Boolean);
  if (!blocos.length) return null;
  const partes = [
    'Histórico da planilha de prospecção (importado para o CRM):',
    ...blocos.map((b) => `• ${b}`),
  ];
  if (e.ultimoContato) {
    const [a, m, d] = e.ultimoContato.split('-');
    partes.push(`Último contato registrado na planilha: ${d}/${m}/${a}.`);
  }
  return partes.join('\n').slice(0, 5000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
