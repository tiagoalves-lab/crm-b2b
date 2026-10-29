import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TASK_ATTACHMENTS_BUCKET = 'task-attachments';
// Áudio das ligações (migration 20261026180000_telefonia_gravacoes). Bucket
// à parte, sem nenhuma URL de download gerada pra ele: o áudio não aparece
// em tela nenhuma (docs/telefonia-crm.md, decisão 1.8).
export const GRAVACOES_BUCKET = 'gravacoes';

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

  // Upload feito PELO backend (não pelo navegador com URL assinada): é o
  // caminho de arquivo que o próprio servidor produziu — hoje o PDF da
  // proposta, gerado a partir do HTML congelado no app de cotações. Aqui não
  // existe usuário com aba aberta pra assinar upload; e o ponto da feature é
  // justamente o arquivo nunca passar pela mão de ninguém.
  async upload(
    path: string,
    bytes: Buffer,
    contentType: string,
    bucket: string = TASK_ATTACHMENTS_BUCKET,
  ): Promise<void> {
    const { error } = await this.getClient()
      .storage.from(bucket)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) {
      throw new InternalServerErrorException(
        `Erro ao gravar arquivo no storage: ${error.message}`,
      );
    }
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

  // Leitura feita PELO backend, sem URL nenhuma: hoje só a transcrição das
  // gravações (TranscricaoService), que manda o áudio ao Groq.
  async download(path: string, bucket: string): Promise<Buffer> {
    const { data, error } = await this.getClient()
      .storage.from(bucket)
      .download(path);
    if (error || !data) {
      throw new InternalServerErrorException(
        `Erro ao ler arquivo do storage: ${error?.message ?? 'desconhecido'}`,
      );
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(
    path: string,
    bucket: string = TASK_ATTACHMENTS_BUCKET,
  ): Promise<void> {
    const { error } = await this.getClient()
      .storage.from(bucket)
      .remove([path]);
    if (error) {
      throw new InternalServerErrorException(
        `Erro ao remover anexo do storage: ${error.message}`,
      );
    }
  }
}
