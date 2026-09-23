import type { Prisma } from '@prisma/client';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';

// Registro de exclusões (pedido do usuário, 2026-09-16). Motivo: duas
// tarefas sumiram e não havia como saber quem excluiu nem o que havia
// nelas — a exclusão de tarefa é definitiva no banco.
//
// Toda exclusão feita pelas telas grava aqui, NA MESMA TRANSAÇÃO do
// delete: se o registro falhar, a exclusão também não acontece (nunca
// existe exclusão sem rastro). Guarda quem, quando, o quê e uma cópia do
// registro como estava antes de sair — é a cópia que permite recadastrar.
//
// Exclusões automáticas da sincronização com o eGestor ficam de fora: não
// são ação de ninguém, e o próprio módulo tem histórico de requisições.

export const ENTIDADES_EXCLUIDAS = [
  'tarefa',
  'tarefa_comentario',
  'tarefa_anexo',
  'tarefa_checklist',
  'oportunidade',
  'oportunidade_comentario',
  'oportunidade_anexo',
  'oportunidade_item',
  'empresa',
  'contato',
  'membro',
  'pipeline',
  'etapa',
  'motivo_perda',
] as const;

export type EntidadeExcluida = (typeof ENTIDADES_EXCLUIDAS)[number];

const MAX_TITULO = 300;

export async function registrarExclusao(
  tx: TenantTx,
  membership: MembershipContext,
  dados: {
    entidade: EntidadeExcluida;
    registroId: string;
    // Como a pessoa reconhece o registro na lista: título da tarefa, nome
    // da empresa, nome do arquivo, começo do comentário.
    titulo: string;
    // Onde ele estava: a tarefa do comentário, a empresa da oportunidade.
    contexto?: string | null;
    // O registro inteiro antes da exclusão (e o que foi junto em cascata).
    snapshot: unknown;
  },
): Promise<void> {
  const titulo = dados.titulo.trim() || '(sem título)';
  await tx.deletionLog.create({
    data: {
      workspaceId: membership.workspaceId,
      actorUserId: membership.userId,
      entidade: dados.entidade,
      registroId: dados.registroId,
      titulo:
        titulo.length > MAX_TITULO ? `${titulo.slice(0, MAX_TITULO)}…` : titulo,
      contexto: dados.contexto ?? null,
      // Ida e volta por JSON: Date vira texto ISO e Decimal do Prisma vira
      // texto — o que a coluna jsonb aceita.
      // BigInt (tamanho de anexo em bytes) não tem serialização nativa e
      // derruba o JSON.stringify, então vira texto aqui — sem isso,
      // excluir anexo respondia 500.
      snapshot: JSON.parse(
        JSON.stringify(dados.snapshot ?? {}, (_chave, valor: unknown) =>
          typeof valor === 'bigint' ? valor.toString() : valor,
        ),
      ) as Prisma.InputJsonValue,
    },
  });
}

// Nome da empresa pra coluna "contexto" — mesma prioridade das listas.
export async function nomeDaEmpresa(
  tx: TenantTx,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  const company = await tx.company.findFirst({
    where: { id: companyId },
    select: { razaoSocial: true, fantasia: true, nomeParaContato: true },
  });
  if (!company) return null;
  return (
    company.razaoSocial?.trim() ||
    company.fantasia?.trim() ||
    company.nomeParaContato?.trim() ||
    null
  );
}

// Primeira linha curta de um texto longo (comentário) pra servir de título.
export function resumo(texto: string, max = 120): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > max ? `${limpo.slice(0, max)}…` : limpo;
}
