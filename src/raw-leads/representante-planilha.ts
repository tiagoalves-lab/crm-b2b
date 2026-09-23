import type { MembershipRole } from '@prisma/client';
import type { MemberIdentity } from '../memberships/supabase-user.service';

// Coluna "Representante" do modelo de importação (pedido do usuário,
// 2026-09-23): quem importa a planilha pode dizer, linha a linha, de quem
// é o lead. Vazio = o lead fica com quem está importando (comportamento
// anterior, inalterado).
//
// Por que o dono não é mais "sempre quem está autenticado": na prática
// quem tem a planilha na mão é o gerente/administrador, e ele precisa
// distribuir os prospects entre os representantes da equipe sem depender
// de cada um importar a sua parte. Representante comum NÃO distribui —
// importa sempre pra própria carteira, mesmo que escreva outro nome na
// coluna (senão qualquer um poderia empurrar lead pra carteira alheia).
const PAPEIS_QUE_DISTRIBUEM: readonly MembershipRole[] = [
  'owner',
  'admin',
  'manager',
];

export function podeDistribuirLeads(role: MembershipRole): boolean {
  return PAPEIS_QUE_DISTRIBUEM.includes(role);
}

// Mesma normalização de comparação usada nos cabeçalhos da planilha
// (spreadsheet-import.util.ts): sem acento, sem caixa e sem espaço/
// pontuação — "Fulano de Tal", "fulano de tal" e "FULANO  DE TAL" são a
// mesma pessoa pro usuário que digita na célula.
export function normalizarRepresentante(valor: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.]/g, '');
}

// Índice invertido nome/login/e-mail → userId, mesma ordem de desempate do
// casamento de vendedor do eGestor (EgestorUsuarioService): e-mail é o
// mais confiável, login e nome entram depois. Chave repetida (dois membros
// com o mesmo nome) fica com o primeiro e é marcada como ambígua — casar
// na pessoa errada aqui significa lead na carteira errada, então o erro de
// linha custa menos que o palpite.
export interface IndiceRepresentantes {
  porChave: Map<string, string>;
  ambiguas: Set<string>;
}

export function indexarRepresentantes(
  identidades: Map<string, MemberIdentity>,
): IndiceRepresentantes {
  const porChave = new Map<string, string>();
  const ambiguas = new Set<string>();

  for (const [userId, identidade] of identidades) {
    const chaves = [identidade.email, identidade.login, identidade.name]
      .map(normalizarRepresentante)
      .filter(Boolean);
    for (const chave of new Set(chaves)) {
      const jaTem = porChave.get(chave);
      if (jaTem === undefined) {
        porChave.set(chave, userId);
      } else if (jaTem !== userId) {
        ambiguas.add(chave);
      }
    }
  }

  return { porChave, ambiguas };
}

export type ResolucaoRepresentante =
  { ok: true; userId: string } | { ok: false; motivo: string };

export function resolverRepresentante(
  texto: string | undefined,
  indice: IndiceRepresentantes,
  quemImporta: { userId: string; role: MembershipRole },
): ResolucaoRepresentante {
  const chave = normalizarRepresentante(texto ?? '');
  if (!chave) return { ok: true, userId: quemImporta.userId };

  if (indice.ambiguas.has(chave)) {
    return {
      ok: false,
      motivo: `Representante "${texto?.trim()}" corresponde a mais de um membro — use o login ou o e-mail.`,
    };
  }

  const userId = indice.porChave.get(chave);
  if (!userId) {
    return {
      ok: false,
      motivo: `Representante "${texto?.trim()}" não encontrado na equipe (use o nome, o login ou o e-mail cadastrado em Membros).`,
    };
  }

  if (userId !== quemImporta.userId && !podeDistribuirLeads(quemImporta.role)) {
    return {
      ok: false,
      motivo:
        'Só gerente, administrador ou proprietário podem importar leads para outro representante.',
    };
  }

  return { ok: true, userId };
}
