import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const ESTABELECIMENTOS = ['matriz', 'filial'] as const;

export class SyncEmitidasQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde deve ser AAAA-MM-DD.' })
  desde?: string;
}

// Relatório "Resumo de notas emitidas": período livre (data rápida da
// tela), estabelecimento, tipo, situação e operação opcionais.
export class RelatorioReceitaQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inicio deve ser AAAA-MM-DD.' })
  inicio!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fim deve ser AAAA-MM-DD.' })
  fim!: string;

  @IsOptional()
  @IsIn(ESTABELECIMENTOS)
  estabelecimento?: (typeof ESTABELECIMENTOS)[number];

  @IsOptional()
  @IsIn(['produto', 'servico'])
  tipo?: 'produto' | 'servico';

  @IsOptional()
  @IsIn(['autorizada', 'cancelada'])
  situacao?: 'autorizada' | 'cancelada';

  // Só as notas de receita (padrão) ou todas as emitidas, pra conferir
  // com a lista do eGestor (pedido do usuário, 2026-10-27).
  @IsOptional()
  @IsIn(['receita', 'todas'])
  notas?: 'receita' | 'todas';

  // Natureza da operação exatamente como está na nota (a tela oferece as
  // do período); NFS-e é sempre OPERACAO_SERVICO.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  operacao?: string;
}

// Controle de remessas: período pela data da remessa; estabelecimento,
// lado e situação do retorno opcionais.
export class RemessasQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inicio deve ser AAAA-MM-DD.' })
  inicio!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fim deve ser AAAA-MM-DD.' })
  fim!: string;

  @IsOptional()
  @IsIn(ESTABELECIMENTOS)
  estabelecimento?: (typeof ESTABELECIMENTOS)[number];

  @IsOptional()
  @IsIn(['enviada', 'recebida'])
  lado?: 'enviada' | 'recebida';

  // pendente = em aberto ou parcial (tudo que não voltou por inteiro)
  @IsOptional()
  @IsIn(['pendente', 'retornada'])
  retorno?: 'pendente' | 'retornada';
}

// Ligar ou desfazer à mão um retorno numa remessa (decisão 7.5). As notas
// vão pela chave de acesso de 44 dígitos.
export class VinculoRemessaDto {
  @Matches(/^\d{44}$/, { message: 'remessaChave deve ser a chave de acesso da nota (44 dígitos).' })
  remessaChave!: string;

  @Matches(/^\d{44}$/, { message: 'retornoChave deve ser a chave de acesso da nota (44 dígitos).' })
  retornoChave!: string;
}

// Marcar um alerta do Controle de remessas como tratado, ou reabri-lo
// (decisão 7.7). A regra é o código do acervo da tela; a observação é
// obrigatória pra tratar (o serviço confere) e vai pro log.
export class AlertaRemessaDto {
  @Matches(/^\d{44}$/, { message: 'remessaChave deve ser a chave de acesso da nota (44 dígitos).' })
  remessaChave!: string;

  @Matches(/^[a-z0-9-]{1,60}$/, { message: 'regra inválida.' })
  regra!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;
}

// Classificação dos itens das notas de entrada (decisão 7.8). O código é
// o que o banco grava; o rótulo e o grupo ficam na tela.
export const CLASSES_ENTRADA = [
  'revenda',
  'industrializacao',
  'mat-aplic-servico',
  'imobilizado',
  'uso-consumo',
  'viagem',
  'remessa',
  'retorno',
  'transferencia',
  'devolucao',
  'icms',
  'cancelada',
  'desconhecimento',
] as const;
export type ClasseEntrada = (typeof CLASSES_ENTRADA)[number];

// Notas de entrada: período pela data de emissão; estabelecimento opcional.
export class EntradasQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inicio deve ser AAAA-MM-DD.' })
  inicio!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fim deve ser AAAA-MM-DD.' })
  fim!: string;

  @IsOptional()
  @IsIn(ESTABELECIMENTOS)
  estabelecimento?: (typeof ESTABELECIMENTOS)[number];
}

// Classificar itens de uma nota de entrada. Sem `itens`, vale pra todos os
// itens da nota; classe nula retira a classificação.
export class ClassificarEntradaDto {
  @Matches(/^\d{44}$/, { message: 'chave deve ser a chave de acesso da nota (44 dígitos).' })
  chave!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(990)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(990, { each: true })
  itens?: number[];

  @IsOptional()
  @IsIn(CLASSES_ENTRADA)
  classe?: ClasseEntrada | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;
}

// Consultar notas (aba do console fiscal, pedido do usuário 2026-10-28):
// pesquisa livre em todas as notas — NF-e emitidas e recebidas e NFS-e.
// Na tela ficam período, empresa, número e item; o resto vem da janela
// "Mais filtros". Listas (cfop, marcas, impostos) vão separadas por vírgula.
export const VISOES_CONSULTA = ['nota', 'item', 'empresa', 'cfop', 'mes'] as const;
export const MARCAS_CFOP = [
  'receita',
  'remessa',
  'exige-retorno',
  'retorno',
  'transferencia',
  'importacao',
  'dev-venda',
  'dev-compra',
  'sem-cadastro',
] as const;
export const IMPOSTOS_CONSULTA = ['icms', 'st', 'ipi', 'difal', 'iss', 'retencao'] as const;
const VALOR = /^\d{1,13}(\.\d{1,2})?$/;

export class ConsultaNotasQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'inicio deve ser AAAA-MM-DD.' })
  inicio!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fim deve ser AAAA-MM-DD.' })
  fim!: string;

  @IsOptional()
  @IsIn(VISOES_CONSULTA)
  ver?: (typeof VISOES_CONSULTA)[number];

  // Nome/razão social, ou CNPJ/CPF (só dígitos, pelo começo — a raiz traz
  // todas as filiais).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  empresa?: string;

  @IsOptional()
  @Matches(/^\d{1,12}$/, { message: 'numero deve ter só dígitos.' })
  numero?: string;

  // Descrição ou código do produto/serviço.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  item?: string;

  @IsOptional()
  @IsIn(['nfe', 'nfse'])
  doc?: 'nfe' | 'nfse';

  // resumo = NF-e recebida que o eGestor só tem em resumo (sem ciência).
  @IsOptional()
  @IsIn(['autorizada', 'cancelada', 'denegada', 'inutilizada', 'resumo'])
  situacao?: 'autorizada' | 'cancelada' | 'denegada' | 'inutilizada' | 'resumo';

  @IsOptional()
  @Matches(/^\d{1,5}$/, { message: 'serie deve ter só dígitos.' })
  serie?: string;

  // Chave de acesso inteira ou o começo dela.
  @IsOptional()
  @Matches(/^\d{1,44}$/, { message: 'chave deve ter só dígitos.' })
  chave?: string;

  // Entrada ou saída, como está no XML (tpNF).
  @IsOptional()
  @IsIn(['entrada', 'saida'])
  sentido?: 'entrada' | 'saida';

  // gama = emitida pela Gama; terceiro = recebida de fornecedor/cliente.
  @IsOptional()
  @IsIn(['gama', 'terceiro'])
  emitente?: 'gama' | 'terceiro';

  @IsOptional()
  @IsIn(ESTABELECIMENTOS)
  estabelecimento?: (typeof ESTABELECIMENTOS)[number];

  // Transferência Matriz ⇄ Filial (decisão 2.3.2): deixar de fora ou só ela.
  @IsOptional()
  @IsIn(['excluir', 'so'])
  transferencia?: 'excluir' | 'so';

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'uf deve ter 2 letras.' })
  uf?: string;

  // NCM pelo começo.
  @IsOptional()
  @Matches(/^\d{2,8}$/, { message: 'ncm deve ter de 2 a 8 dígitos.' })
  ncm?: string;

  // Código da lista de serviços (NFS-e), ex. 14.01.
  @IsOptional()
  @Matches(/^[\d.]{1,10}$/, { message: 'servico inválido.' })
  servico?: string;

  // Classificação do item de entrada (decisão 7.8); "sem" = não classificado.
  @IsOptional()
  @IsIn([...CLASSES_ENTRADA, 'sem'])
  classe?: ClasseEntrada | 'sem';

  // Códigos de CFOP; "x" vale qualquer dígito (59xx = a faixa toda).
  @IsOptional()
  @Matches(/^[1-7][0-9x]{3}(,[1-7][0-9x]{3}){0,29}$/, { message: 'cfop inválido.' })
  cfop?: string;

  @IsOptional()
  @Matches(new RegExp(`^(${MARCAS_CFOP.join('|')})(,(${MARCAS_CFOP.join('|')})){0,8}$`), {
    message: 'marcas inválidas.',
  })
  marcas?: string;

  @IsOptional()
  @Matches(new RegExp(`^(${IMPOSTOS_CONSULTA.join('|')})(,(${IMPOSTOS_CONSULTA.join('|')})){0,5}$`), {
    message: 'impostos inválidos.',
  })
  impostos?: string;

  @IsOptional() @Matches(VALOR, { message: 'valor inválido.' }) vNotaMin?: string;
  @IsOptional() @Matches(VALOR, { message: 'valor inválido.' }) vNotaMax?: string;
  @IsOptional() @Matches(VALOR, { message: 'valor inválido.' }) vItemMin?: string;
  @IsOptional() @Matches(VALOR, { message: 'valor inválido.' }) vItemMax?: string;
}
