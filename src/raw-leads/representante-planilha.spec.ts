import type { MemberIdentity } from '../memberships/supabase-user.service';
import {
  indexarRepresentantes,
  resolverRepresentante,
} from './representante-planilha';

// Dados 100% fictícios (nunca real de empresa/pessoa — ver docs/seguranca.md).
const GERENTE = '00000000-0000-0000-0000-00000000000a';
const REP = '00000000-0000-0000-0000-00000000000b';
const OUTRO_REP = '00000000-0000-0000-0000-00000000000c';

function identidades(
  entries: Array<[string, Partial<MemberIdentity>]>,
): Map<string, MemberIdentity> {
  return new Map(
    entries.map(([userId, id]) => [
      userId,
      { login: '', name: null, email: null, ...id },
    ]),
  );
}

const INDICE = indexarRepresentantes(
  identidades([
    [GERENTE, { login: 'gerente', name: 'Gerente Ficticio' }],
    [
      REP,
      {
        login: 'repum',
        name: 'Representante Fictício',
        email: 'rep@ficticia.example.com',
      },
    ],
    [OUTRO_REP, { login: 'repdois', name: 'Outro Representante' }],
  ]),
);

describe('resolverRepresentante', () => {
  it('coluna vazia mantém o lead com quem está importando', () => {
    expect(
      resolverRepresentante('', INDICE, { userId: GERENTE, role: 'manager' }),
    ).toEqual({ ok: true, userId: GERENTE });
  });

  it('casa pelo nome ignorando acento e caixa', () => {
    expect(
      resolverRepresentante('representante ficticio', INDICE, {
        userId: GERENTE,
        role: 'manager',
      }),
    ).toEqual({ ok: true, userId: REP });
  });

  it('casa pelo login e pelo e-mail', () => {
    const quem = { userId: GERENTE, role: 'manager' as const };
    expect(resolverRepresentante('repdois', INDICE, quem)).toEqual({
      ok: true,
      userId: OUTRO_REP,
    });
    expect(
      resolverRepresentante('rep@ficticia.example.com', INDICE, quem),
    ).toEqual({ ok: true, userId: REP });
  });

  it('nome que não existe na equipe vira erro de linha', () => {
    const res = resolverRepresentante('Ninguem Aqui', INDICE, {
      userId: GERENTE,
      role: 'manager',
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.motivo).toMatch(/não encontrado/i);
  });

  // Barreira contra empurrar lead pra carteira alheia: só quem tem alçada
  // distribui (ver PAPEIS_QUE_DISTRIBUEM).
  it('representante comum não importa para outra pessoa', () => {
    const res = resolverRepresentante('Outro Representante', INDICE, {
      userId: REP,
      role: 'sales_rep',
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.motivo).toMatch(/gerente/i);
  });

  it('representante comum pode escrever o próprio nome', () => {
    expect(
      resolverRepresentante('Representante Fictício', INDICE, {
        userId: REP,
        role: 'sales_rep',
      }),
    ).toEqual({ ok: true, userId: REP });
  });

  it('nome repetido em dois membros não escolhe no palpite', () => {
    const ambiguo = indexarRepresentantes(
      identidades([
        [REP, { login: 'repum', name: 'Nome Repetido' }],
        [OUTRO_REP, { login: 'repdois', name: 'Nome Repetido' }],
      ]),
    );
    const res = resolverRepresentante('Nome Repetido', ambiguo, {
      userId: GERENTE,
      role: 'admin',
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.motivo).toMatch(/mais de um membro/i);
  });
});
