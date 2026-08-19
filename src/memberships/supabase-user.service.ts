import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cria login (Supabase Auth) pra um novo membro — usa a service role key
// (Admin API), nunca a anon key. Mesmo padrão de isolamento de
// src/storage/supabase-storage.service.ts: a key nunca sai do processo
// Node, o cliente próprio nunca a vê. `email_confirm: true` porque não
// existe fluxo de convite por e-mail neste projeto (adiado no roadmap) —
// o admin que cria já define a senha e comunica direto pro membro, login
// funciona imediatamente sem confirmação.
//
// Regra de negócio do resto do app: login é texto livre, sem e-mail
// envolvido — é só o identificador de acesso. A API do Supabase Auth
// exige um identificador em formato de e-mail (não dá pra mudar isso sem
// trocar de provedor) — resolvido só aqui dentro, convertendo o login pro
// formato exigido só na hora de chamar o Supabase. Mesmo domínio fixo
// usado em web/lib/auth-login.ts pro fluxo de sign-in (que fala direto
// com o Supabase, sem passar pelo backend, e por isso replica esta mesma
// conversão do lado do front). O e-mail de CONTATO do membro (pedido do
// usuário, 2026-08-06) é um campo à parte, opcional, guardado em
// user_metadata.email — nunca confundir com o e-mail sintético/de auth
// gerado aqui.
const LOGIN_DOMAIN = 'login.gamabrasil.com.br';

// `.toLowerCase()` aqui é só pro FORMATO exigido pelo Supabase Auth (a
// API rejeita e-mail com maiúscula em alguns pontos, e por convenção
// e-mail é tratado como case-insensitive de qualquer forma) — não afeta
// o que aparece pro usuário: o login digitado ORIGINAL (com a
// capitalização de verdade) é guardado à parte em user_metadata.login
// (ver createUser/updateUserLogin) e é isso que GET /memberships exibe,
// nunca o e-mail sintético. Bug real corrigido (2026-08-06, usuário
// reportou "o login está sendo forçado a minúsculo"): antes disso o
// login exibido vinha só de fromAuthEmail(user.email), que devolvia a
// versão já minúscula — a capitalização digitada se perdia.
function toAuthEmail(login: string): string {
  const trimmed = login.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${LOGIN_DOMAIN}`;
}

// Fallback pra exibição de contas antigas que nunca tiveram
// user_metadata.login preenchido (criadas antes dessa correção) — nesse
// caso não tem como recuperar a capitalização original, só descascar o
// domínio sintético do e-mail mesmo (minúsculo).
function fromAuthEmail(email: string): string {
  const suffix = `@${LOGIN_DOMAIN}`;
  return email.toLowerCase().endsWith(suffix)
    ? email.slice(0, -suffix.length)
    : email;
}

export interface MemberIdentity {
  login: string;
  name: string | null;
  // Contato do membro (2026-08-06) — separado do login de propósito (login
  // é só o identificador de acesso, ver toAuthEmail acima). Guardado em
  // user_metadata.email, mesmo lugar de `name`, nunca no e-mail sintético
  // que o Supabase Auth usa pra autenticação.
  email: string | null;
}

@Injectable()
export class SupabaseUserService {
  private readonly logger = new Logger(SupabaseUserService.name);
  private client: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): SupabaseClient {
    if (this.client) return this.client;

    const url = this.configService.get<string>('supabaseUrl');
    const serviceRoleKey = this.configService.get<string>(
      'supabaseServiceRoleKey',
    );
    if (!url || !serviceRoleKey) {
      throw new InternalServerErrorException(
        'Criação de membro indisponível: SUPABASE_SERVICE_ROLE_KEY não configurada no backend.',
      );
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return this.client;
  }

  async createUser(
    login: string,
    password: string,
    name: string,
    email?: string,
  ): Promise<{ id: string }> {
    const { data, error } = await this.getClient().auth.admin.createUser({
      email: toAuthEmail(login),
      password,
      email_confirm: true,
      // login aqui é o texto ORIGINAL (não o toAuthEmail minúsculo acima)
      // — é o que GET /memberships exibe, preserva exatamente o que foi
      // digitado no cadastro.
      user_metadata: { name, email: email ?? null, login: login.trim() },
    });

    if (error) {
      if (/already.*registered|already.*exists/i.test(error.message)) {
        throw new ConflictException('Já existe um usuário com este login.');
      }
      throw new InternalServerErrorException(
        `Erro ao criar usuário: ${error.message}`,
      );
    }
    if (!data.user) {
      throw new InternalServerErrorException(
        'Erro ao criar usuário: resposta vazia do Supabase.',
      );
    }
    return { id: data.user.id };
  }

  // Enriquece a lista de membros (GET /memberships) com nome/login pra
  // exibição — Membership só guarda user_id (FK lógica pra auth.users, ver
  // comentário no topo do arquivo). Chamado FORA de qualquer transação do
  // Postgres (TenantContextService.run abre `$transaction`, e essa
  // chamada é uma requisição HTTP pro Supabase Auth — segurar a
  // transação aberta esperando ela é como o pool já estourou antes, ver
  // memória do projeto). Falha aqui não pode derrubar a tela inteira de
  // Membros: se o Admin API falhar (ex.: key ainda não configurada),
  // devolve mapa vazio e a UI cai pro fallback de ID curto.
  async getIdentities(userIds: string[]): Promise<Map<string, MemberIdentity>> {
    const map = new Map<string, MemberIdentity>();
    if (userIds.length === 0) return map;

    let client: SupabaseClient;
    try {
      client = this.getClient();
    } catch (err) {
      this.logger.warn(
        `getIdentities: client indisponível — ${(err as Error).message}`,
      );
      return map;
    }

    const wanted = new Set(userIds);
    const { data, error } = await client.auth.admin.listUsers({
      perPage: 1000,
    });
    if (error || !data) {
      this.logger.warn(
        `getIdentities: listUsers falhou — ${error?.message ?? 'resposta vazia'}`,
      );
      return map;
    }

    for (const user of data.users) {
      if (!wanted.has(user.id)) continue;
      const meta = user.user_metadata as Record<string, unknown> | null;
      const metaName = meta?.name;
      const metaEmail = meta?.email;
      const metaLogin = meta?.login;
      map.set(user.id, {
        // Prefere o login ORIGINAL guardado em user_metadata.login (ver
        // createUser/updateUserLogin) — só cai pro fromAuthEmail
        // (minúsculo, sem capitalização) em conta antiga que nunca teve
        // esse campo preenchido.
        login:
          typeof metaLogin === 'string' && metaLogin.trim()
            ? metaLogin
            : fromAuthEmail(user.email ?? ''),
        name: typeof metaName === 'string' && metaName.trim() ? metaName : null,
        email:
          typeof metaEmail === 'string' && metaEmail.trim() ? metaEmail : null,
      });
    }
    return map;
  }

  // Corrige nome/e-mail exibidos de um membro já existente (ver
  // comentário no UpdateMembershipDto). Best-effort: se falhar, não
  // derruba o PATCH inteiro — role/status/managerId já foram salvos no
  // Postgres antes desta chamada (controller chama isso depois do
  // tenantContext.run).
  //
  // Lê o user_metadata atual antes de escrever: a Admin API do Supabase
  // SUBSTITUI o objeto inteiro de user_metadata em vez de fazer merge
  // (mesmo comportamento já documentado pra Company.customFields via
  // Prisma) — escrever só `{ name }` ou só `{ email }` direto apagaria o
  // outro campo em silêncio.
  async updateUserProfile(
    userId: string,
    patch: { name?: string; email?: string },
  ): Promise<void> {
    let client: SupabaseClient;
    try {
      client = this.getClient();
    } catch (err) {
      this.logger.warn(
        `updateUserProfile: client indisponível — ${(err as Error).message}`,
      );
      return;
    }

    const { data: current, error: fetchError } =
      await client.auth.admin.getUserById(userId);
    if (fetchError || !current.user) {
      this.logger.warn(
        `updateUserProfile: falhou ao buscar ${userId} — ${fetchError?.message ?? 'usuário não encontrado'}`,
      );
      return;
    }

    const existingMeta = (current.user.user_metadata ?? {}) as Record<
      string,
      unknown
    >;
    const { error } = await client.auth.admin.updateUserById(userId, {
      user_metadata: { ...existingMeta, ...patch },
    });
    if (error) {
      this.logger.warn(
        `updateUserProfile: falhou pra ${userId} — ${error.message}`,
      );
    }
  }

  // Troca o login (o identificador de acesso, ver comentário no topo do
  // arquivo) — na prática troca o e-mail do usuário no Supabase Auth,
  // convertido pro mesmo formato sintético de createUser, E o
  // user_metadata.login (texto original, com a capitalização de
  // verdade — mesmo cuidado de createUser, e mesmo motivo de merge de
  // updateUserProfile: escrever user_metadata sem antes ler o que já
  // existe apagaria name/email em silêncio). Mesmo critério de
  // updateUserPassword abaixo (não de updateUserProfile): login é
  // credencial de acesso, não cosmético — o admin precisa saber na hora
  // se falhou (ex.: login já usado por outro membro) antes de comunicar
  // um login que na verdade não mudou. `email_confirm: true` pelo mesmo
  // motivo de createUser — sem isso o Supabase marcaria o e-mail novo
  // como não confirmado e o login novo não funcionaria até confirmar um
  // link que não existe (não há fluxo de e-mail neste projeto).
  async updateUserLogin(userId: string, login: string): Promise<void> {
    const client = this.getClient();

    const { data: current, error: fetchError } =
      await client.auth.admin.getUserById(userId);
    if (fetchError || !current.user) {
      throw new InternalServerErrorException(
        `Erro ao atualizar login: ${fetchError?.message ?? 'usuário não encontrado'}`,
      );
    }
    const existingMeta = (current.user.user_metadata ?? {}) as Record<
      string,
      unknown
    >;

    const { error } = await client.auth.admin.updateUserById(userId, {
      email: toAuthEmail(login),
      email_confirm: true,
      user_metadata: { ...existingMeta, login: login.trim() },
    });
    if (error) {
      if (/already.*registered|already.*exists/i.test(error.message)) {
        throw new ConflictException('Já existe um usuário com este login.');
      }
      throw new InternalServerErrorException(
        `Erro ao atualizar login: ${error.message}`,
      );
    }
  }

  // Redefine a senha do login — não existe "ver senha" possível (Supabase
  // guarda só hash, igual qualquer sistema seguro). Ao contrário de
  // updateUserProfile (cosmético, falha silenciosa é ok), aqui o admin
  // precisa saber se falhou antes de repassar a senha nova pro membro —
  // por isso propaga a exceção em vez de engolir.
  async updateUserPassword(userId: string, password: string): Promise<void> {
    const { error } = await this.getClient().auth.admin.updateUserById(userId, {
      password,
    });
    if (error) {
      throw new InternalServerErrorException(
        `Erro ao redefinir senha: ${error.message}`,
      );
    }
  }
}
