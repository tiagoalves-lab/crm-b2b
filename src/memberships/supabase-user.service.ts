import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
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
@Injectable()
export class SupabaseUserService {
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

  async createUser(email: string, password: string): Promise<{ id: string }> {
    const { data, error } = await this.getClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      if (/already.*registered|already.*exists/i.test(error.message)) {
        throw new ConflictException('Já existe um usuário com este e-mail.');
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
}
