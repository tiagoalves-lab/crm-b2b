// Tipos compartilhados do módulo de integração eGestor. Ver
// docs/roadmap.md e docs/api-egestor-contatos.md.

export type Estabelecimento = 'matriz' | 'filial';

// Formato cru de um contato, como a API do eGestor devolve — só os campos
// que o sync usa (ver CAMPOS_CONTATO abaixo). Mantido solto (Record) em
// vez de uma interface fechada porque o payload inteiro é persistido como
// JSON em `dadosMatriz`/`dadosFilial` sem transformação — não vale a pena
// tipar campo a campo algo que só é lido de volta como blob.
export type EgestorContatoRaw = Record<string, unknown> & {
  codigo: number | string;
  cpfcnpj?: string;
  nome?: string;
  tipo?: string[];
};

// Mesma lista de campos usada pelo script de referência da Gama
// (Integrar-bases-egestor.txt, CAMPOS_CONTATO) — pedidos explicitamente
// no `fields=` de toda chamada a /contatos, e também a lista usada pra
// decidir "campos diferentes" na consolidação (ver
// egestor-contato-sync.service.ts).
export const CAMPOS_CONTATO = [
  'codigo',
  'nome',
  'fantasia',
  'nomeParaContato',
  'cpfcnpj',
  'tipo',
  'dtNasc',
  'dtCad',
  'emails',
  'fones',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cep',
  'codIBGE',
  'cidade',
  'uf',
  'clienteFinal',
  'indicadorIE',
  'inscricaoMunicipal',
  'inscricaoEstadual',
  'obs',
  'tags',
] as const;

// Campos ignorados na comparação Matriz×Filial (mesmo critério do script
// de referência, `listarDiferencas_`): `codigo` é sempre diferente entre
// as duas contas (numeração própria por conta), `dtCad`/`cidade` não são
// considerados divergência relevante. Mesma lista reaproveitada pra saber
// o que NÃO faz sentido mandar ao criar contato no lado que falta
// (`egestor-contato-correction.service.ts#completarNoEgestor`): `codigo`
// é atribuído pelo eGestor na criação, `dtCad` é a data de cadastro
// (também atribuída lá), `cidade` deriva do `codIBGE` enviado.
export const CAMPOS_IGNORADOS_NA_COMPARACAO = new Set([
  'codigo',
  'dtCad',
  'cidade',
]);

// Campos de lista dentro de CAMPOS_CONTATO — únicos onde "Consolidar"
// (egestor-contato-correction.service.ts#aplicarConsolidacaoNoEgestor)
// faz sentido: em vez de escolher um lado pra sobrescrever o outro (como
// "Corrigir"), une os dois lados (ex.: Matriz tem 1 e-mail, Filial tem
// outro — consolidar deixa os dois e-mails nos dois lados). Campo
// escalar (nome, uf, etc.) não entra aqui — não tem como "unir" duas
// strings diferentes numa closed sem virar patch parcial arriscado.
export const CAMPOS_ARRAY = new Set(['emails', 'fones', 'tags', 'tipo']);

// `emails`/`fones` vêm do GET como array de OBJETO com chave variável
// (ver docs/api-egestor-contatos.md, "Formato real de emails/fones") —
// mas os exemplos de `POST`/`PUT` mostram array de STRING simples. Extrai
// defensivamente o primeiro campo não-vazio de cada item (aceita string
// solta também, já no formato esperado de escrita, sem duplo-processar).
// Compartilhado entre `egestor-contato-promote.service.ts` (mapeia pra
// `Company.emails`/`fones`) e `egestor-contato-correction.service.ts`
// (monta o body de `POST`/`PUT` de volta pro eGestor).
// Só dígitos, sem máscara — mesmo padrão de normalização usado no script
// de referência (`limparDocumento_`) e em todo o módulo de sync/webhook.
export function limparDocumento(valor: unknown): string {
  return String(valor ?? '').replace(/\D/g, '');
}

export function extrairContatoArray(
  valor: unknown,
  chaves: string[],
): string[] {
  if (!Array.isArray(valor)) return [];
  const out: string[] = [];
  for (const item of valor) {
    if (typeof item === 'string') {
      if (item.trim()) out.push(item.trim());
      continue;
    }
    if (item && typeof item === 'object') {
      for (const chave of chaves) {
        const v = (item as Record<string, unknown>)[chave];
        if (typeof v === 'string' && v.trim()) {
          out.push(v.trim());
          break;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Identificação de contato no histórico de requisições
// (EgestorInteractionLog — botão "Histórico de requisições" da tela
// Integração eGestor). Pedido do usuário, 2026-08-17: até aqui o resumo
// só trazia o número ("código 982"), e não dava pra saber de qual empresa
// era a linha sem abrir o eGestor pra conferir. Formato pedido:
// "código 982 - RAZÃO SOCIAL LTDA, Matriz".
//
// Aqui em vez de dentro do serviço de log porque três call sites
// diferentes montam esse texto (webhook automático, ações manuais da
// tela e propagação da ficha da empresa) e o formato precisa ser o mesmo
// nos três — o log é lido de cima a baixo por um humano.

export function nomeDoEstabelecimento(
  estabelecimento: Estabelecimento,
): string {
  return estabelecimento === 'matriz' ? 'Matriz' : 'Filial';
}

// "código 982 - RAZÃO SOCIAL LTDA, Matriz". Sem nome conhecido, degrada
// pra "código 982, Matriz" — nunca inventa um traço sobrando nem um
// "null" no meio da frase. `estabelecimento` é opcional porque em alguns
// pontos o lado já está dito na própria frase ("no eGestor Filial (código
// 638 - ...)"), e repetir ficaria redundante.
export function descreverContato(
  codigo: string | number | null,
  nome: string | null | undefined,
  estabelecimento?: Estabelecimento,
): string {
  const lado = estabelecimento
    ? `, ${nomeDoEstabelecimento(estabelecimento)}`
    : '';
  const limpo = nome?.trim();
  return limpo
    ? `código ${codigo} - ${limpo}${lado}`
    : `código ${codigo}${lado}`;
}

// "CNPJ 00506489000178 - RAZÃO SOCIAL LTDA" — usado pelas ações manuais,
// que identificam a linha pelo CNPJ (chave de consolidação entre as duas
// contas) em vez do código, que é por conta.
export function descreverEmpresa(
  cpfCnpj: string,
  nome: string | null | undefined,
): string {
  const limpo = nome?.trim();
  return limpo ? `CNPJ ${cpfCnpj} - ${limpo}` : `CNPJ ${cpfCnpj}`;
}

// Razão social de uma linha do espelho. Prefere o nome da Matriz — é o
// registro determinante do cadastro (mesma premissa da direção
// recomendada na tela de correção); cai pro da Filial quando a linha só
// existe daquele lado.
export function nomeDaLinha(row: {
  nomeMatriz: string | null;
  nomeFilial: string | null;
}): string | null {
  return row.nomeMatriz?.trim() || row.nomeFilial?.trim() || null;
}
