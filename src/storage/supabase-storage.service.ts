import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TASK_ATTACHMENTS_BUCKET = 'task-attachments';

// Cliente com a service role key — bypassa RLS/policy de Storage de
// propósito. A fronteira de segurança não é o Storage, é o backend: quem
// chama isto já passou por TaskService.mustBeVisible (workspace + policy)
// antes. A key nunca sai do processo Node (nunca vai pro cliente/web).
@Injectable()
export class SupabaseStorageService {
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
        'Upload de anexos indisponível: SUPABASE_SERVICE_ROLE_KEY não configurada no backend.',
      );
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return this.client;
  }

  async createUploadUrl(
    path: string,
  ): Promise<{ signedUrl: string; token: string }> {
    const { data, error } = await this.getClient()
      .storage.from(TASK_ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new InternalServerErrorException(
        `Erro ao gerar URL de upload: ${error?.message ?? 'desconhecido'}`,
      );
    }
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async createDownloadUrl(
    path: string,
    expiresInSeconds = 60,
  ): Promise<string> {
    const { data, error } = await this.getClient()
      .storage.from(TASK_ATTACHMENTS_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) {
      throw new InternalServerErrorException(
        `Erro ao gerar URL de download: ${error?.message ?? 'desconhecido'}`,
      );
    }
    return data.signedUrl;
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.getClient()
      .storage.from(TASK_ATTACHMENTS_BUCKET)
      .remove([path]);
    if (error) {
      throw new InternalServerErrorException(
        `Erro ao remover anexo do storage: ${error.message}`,
      );
    }
  }
}
