import { BadRequestException } from '@nestjs/common';
import type { TenantTx } from '../tenancy/tenant-context.service';

// Itens da oportunidade e as tags que nascem deles (2026-09-04).
//
// A lista lateral do card guarda "o que está sendo negociado" (produtos,
// serviços, escopo). Cada item pode ser carimbado como tag num comentário
// do card ou numa tarefa gerada a partir dele. A tag é gravada como texto
// (nome do item na hora do carimbo) — remover o item da lista não apaga o
// carimbo dos registros antigos, que são histórico — mas na hora de
// gravar só passa texto que esteja na lista (mustTagsBeItems). Sem isso
// qualquer cliente da API poderia inventar tag.

export const ITEM_NAME_MAX = 120;
export const ITEMS_MAX = 50;

// Texto livre da negociação — só tira espaço sobrando (a padronização em
// caixa alta do CRM vale pra cadastro de empresa/lead, não aqui).
export function normalizeItemName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function keyOf(name: string): string {
  return name.toLocaleLowerCase('pt-BR');
}

// Remove vazios e repetidos (sem diferenciar maiúscula/minúscula),
// preservando a primeira grafia e a ordem de entrada.
export function uniqueItemNames(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const name = normalizeItemName(value);
    if (!name) continue;
    const key = keyOf(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// Devolve as tags pedidas com a grafia canônica (a salva na lista), sem
// repetição e na ordem da lista. Qualquer tag que não seja item da
// oportunidade → 400.
export async function mustTagsBeItems(
  tx: TenantTx,
  opportunityId: string,
  tags: readonly string[] | undefined,
): Promise<string[]> {
  if (!tags || tags.length === 0) return [];
  const items = await tx.opportunityItem.findMany({
    where: { opportunityId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { name: true },
  });
  const canonicalByKey = new Map(
    items.map((item) => [keyOf(item.name), item.name] as const),
  );
  const wanted = new Set<string>();
  for (const value of tags) {
    const name = normalizeItemName(value);
    if (!name) continue;
    const canonical = canonicalByKey.get(keyOf(name));
    if (!canonical) {
      throw new BadRequestException(
        `"${name}" não está na lista de itens desta oportunidade.`,
      );
    }
    wanted.add(canonical);
  }
  return items.map((item) => item.name).filter((name) => wanted.has(name));
}
