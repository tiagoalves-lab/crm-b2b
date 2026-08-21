import { Injectable, Logger } from '@nestjs/common';
import { SupabaseUserService } from '../../memberships/supabase-user.service';
import { EgestorAuthService } from './egestor-auth.service';
import { EgestorHttpService } from './egestor-http.service';
import { chavePorConta } from './egestor.types';
import type { EgestorUsuarioRaw, Estabelecimento } from './egestor.types';

// Vendedor do eGestor já casado (ou não) com um membro do CRM.
export interface VendedorResolvido {
  estabelecimento: Estabelecimento;
  codigo: string;
  nome: string | null;
  // `null` quando nenhum membro do CRM corresponde — vendedor que já saiu
  // da empresa, ou que nunca teve login no CRM. A venda continua sendo
  // importada com `vendedorNome` preenchido; o que falta é só o vínculo.
  userId: string | null;
  // Como o casamento foi feito, pro texto do histórico de requisições.
  casadoPor: 'email' | 'login' | 'nome' | null;
}

function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase();
}

// Lê os vendedores das duas contas eGestor (`GET /v1/usuarios?vendedor=1`,
// ver Usuários em docs/api-egestor-vendas.md) e resolve cada um pro membro
// correspondente do CRM.
//
// Por que o casamento é por e-mail e não por um cadastro manual de-para:
// o eGestor devolve `nome`, `login` e `email` de cada usuário, e o CRM
// guarda e-mail de contato/login do membro em `user_metadata` (Supabase
// Auth, ver SupabaseUserService). E-mail é o único desses três que é
// naturalmente único e estável nos dois lados — login e nome entram só
// como desempate, nessa ordem, e sempre depois do e-mail ter falhado.
//
// Nenhum vínculo é INVENTADO: vendedor que não casa com ninguém fica com
// `userId: null` e aparece no resumo da sincronização. Um de-para errado
// aqui viraria comissão/curva ABC atribuída à pessoa errada, então o
// silêncio custa mais que a lacuna.
@Injectable()
export class EgestorUsuarioService {
  private readonly logger = new Logger(EgestorUsuarioService.name);

  constructor(
    private readonly auth: EgestorAuthService,
    private readonly http: EgestorHttpService,
    private readonly supabaseUsers: SupabaseUserService,
  ) {}

  // `membroUserIds` vem da tabela `memberships` do workspace (lida numa
  // transação curta ANTES desta chamada) — este método é só rede
  // (eGestor + Supabase Auth Admin API) e nunca deve rodar dentro de uma
  // transação do Postgres, mesmo motivo já documentado em
  // EgestorContatoSyncService.
  async resolverVendedores(
    membroUserIds: string[],
  ): Promise<Map<string, VendedorResolvido>> {
    const identidades = await this.supabaseUsers.getIdentities(membroUserIds);

    // Índices invertidos do lado do CRM. Um mesmo e-mail/login em dois
    // membros seria ambíguo — nesse caso o primeiro ganha e o conflito
    // fica registrado no log do servidor (não deveria acontecer: o
    // Supabase Auth já impede login duplicado).
    const porEmail = new Map<string, string>();
    const porLogin = new Map<string, string>();
    const porNome = new Map<string, string>();
    for (const [userId, identidade] of identidades) {
      const email = normalizar(identidade.email);
      const login = normalizar(identidade.login);
      const nome = normalizar(identidade.name);
      if (email && !porEmail.has(email)) porEmail.set(email, userId);
      if (login && !porLogin.has(login)) porLogin.set(login, userId);
      if (nome && !porNome.has(nome)) porNome.set(nome, userId);
    }

    const out = new Map<string, VendedorResolvido>();
    for (const estabelecimento of ['matriz', 'filial'] as const) {
      const usuarios = await this.listarVendedores(estabelecimento);
      for (const usuario of usuarios) {
        const email = normalizar(usuario.email);
        const login = normalizar(usuario.login);
        const nome = normalizar(usuario.nome);

        let userId: string | null = null;
        let casadoPor: VendedorResolvido['casadoPor'] = null;
        if (email && porEmail.has(email)) {
          userId = porEmail.get(email) ?? null;
          casadoPor = 'email';
        } else if (login && porLogin.has(login)) {
          userId = porLogin.get(login) ?? null;
          casadoPor = 'login';
        } else if (nome && porNome.has(nome)) {
          userId = porNome.get(nome) ?? null;
          casadoPor = 'nome';
        }

        out.set(chavePorConta(estabelecimento, usuario.codigo), {
          estabelecimento,
          codigo: String(usuario.codigo),
          nome: typeof usuario.nome === 'string' ? usuario.nome.trim() : null,
          userId,
          casadoPor,
        });
      }
    }

    return out;
  }

  // Best-effort de propósito: se a conta não responder a /usuarios, a
  // carga de vendas NÃO pode parar — o histórico de compra do cliente
  // (que é o objetivo) não depende de saber quem vendeu. Sem a lista, as
  // vendas daquela conta ficam com o nome que já vem no próprio payload
  // da venda (`nomeVendedor`) e sem vínculo com membro.
  private async listarVendedores(
    estabelecimento: Estabelecimento,
  ): Promise<EgestorUsuarioRaw[]> {
    try {
      const accessToken = await this.auth.getAccessToken(estabelecimento);
      return await this.http.getAllPages<EgestorUsuarioRaw>(
        accessToken,
        '/v1/usuarios',
        { vendedor: '1' },
      );
    } catch (err) {
      this.logger.warn(
        `listarVendedores(${estabelecimento}) falhou — vendas seguem sem vínculo de vendedor: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
