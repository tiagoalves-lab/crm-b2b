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
// envolvido. A API do Supabase Auth exige um identificador em formato de
// e-mail (não dá pra mudar isso sem trocar de provedor) — resolvido só
// aqui dentro, convertendo o login pro formato exigido só na hora de
// chamar o Supabase. Mesmo domínio fixo usado em web/lib/auth-login.ts
// pro fluxo de sign-in (que fala direto com o Supabase, sem passar pelo
// backend, e por isso replica esta mesma conversão do lado do front).
const LOGIN_DOMAIN = 'login.gamabrasil.com.br';

function toAuthEmail(login: string): string {
  const trimmed = login.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${LOGIN_DOMAIN}`;
}

// Inverso de toAuthEmail — usado só pra exibição (GET /memberships). Se o
// e-mail não tem o domínio sintético (conta antiga, criada antes desta
// convenção, ou login que já era um e-mail de verdade), mostra ele
// inteiro; não tem como distinguir "login com @" de "e-mail de verdade"
// depois do fato, e não faz diferença pra exibição.
function fromAuthEmail(email: string): string {
  const suffix = `@${LOGIN_DOMAIN}`;
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

export interface MemberIdentity {
  login: string;
  name: string | null;
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
  ): Promise<{ id: string }> {
    const { data, error } = await this.getClient().auth.admin.createUser({
      email: toAuthEmail(login),
      password,
      email_confirm: true,
      user_metadata: { name },
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
      this.logger.warn(`getIdentities: client indisponível — ${(err as Error).message}`);
      return map;
    }

    const wanted = new Set(userIds);
    const { data, error } = await client.auth.admin.listUsers({ perPage: 1000 });
    if (error || !data) {
      this.logger.warn(`getIdentities: listUsers falhou — ${error?.message ?? 'resposta vazia'}`);
      return map;
    }

    for (const user of data.users) {
      if (!wanted.has(user.id)) continue;
      const metaName = (user.user_metadata as Record<string, unknown> | null)?.name;
      map.set(user.id, {
        login: fromAuthEmail(user.email ?? ''),
        name: typeof metaName === 'string' && metaName.trim() ? metaName : null,
      });
    }
    return map;
  }

  // Corrige o nome exibido de um membro já existente (ver comentário no
  // UpdateMembershipDto). Best-effort: se falhar, não derruba o PATCH
  // inteiro — role/status/managerId já foram salvos no Postgres antes
  // desta chamada (controller chama isso depois do tenantContext.run).
  async updateUserName(userId: string, name: string): Promise<void> {
    let client: SupabaseClient;
    try {
      client = this.getClient();
    } catch (err) {
      this.logger.warn(`updateUserName: client indisponível — ${(err as Error).message}`);
      return;
    }

    const { error } = await client.auth.admin.updateUserById(userId, {
      user_metadata: { name },
    });
    if (error) {
      this.logger.warn(`updateUserName: falhou pra ${userId} — ${error.message}`);
    }
  }

  // Redefine a senha do login — não existe "ver senha" possível (Supabase
  // guarda só hash, igual qualquer sistema seguro). Ao contrário de
  // updateUserName (cosmético, falha silenciosa é ok), aqui o admin
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
