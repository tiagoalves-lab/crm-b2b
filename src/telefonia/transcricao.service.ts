import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GRAVACOES_BUCKET,
  SupabaseStorageService,
} from '../storage/supabase-storage.service';
import {
  TenantContextService,
  type TenantContext,
} from '../tenancy/tenant-context.service';

// Transcrição e resumo das gravações (docs/telefonia-crm.md, decisão 1.7).
// Duas idas ao Groq por gravação:
//   1. Whisper transcreve o áudio, em trechos com horário;
//   2. gpt-oss diz quem falou cada trecho (o Whisper não separa vozes) e
//      escreve o resumo. Ele devolve só o NÚMERO do trecho e o falante —
//      o texto literal nunca passa pela reescrita do modelo.
// Roda no agendador, fora de requisição: a gravação chega pelo script da
// máquina e fica "pendente" até aqui. Nada daqui é lido por tela ainda.
//
// Só vai ao Groq o áudio e o texto da conversa — nenhum dado de cadastro
// do cliente (empresa, CNPJ, nome) entra no pedido.

const WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';
const GROQ_URL = 'https://api.groq.com/openai/v1';
const MODELO_FALA = 'whisper-large-v3';
const MODELO_RESUMO = 'openai/gpt-oss-120b';
// Limite do plano gratuito do Groq para envio de arquivo.
const MAX_BYTES_GROQ = 25 * 1024 * 1024;
const MAX_TENTATIVAS = 3;
// Por rodada. O plano gratuito aceita 20 pedidos por minuto no Whisper; 10
// gravações a cada 5 minutos fica longe disso e esvazia a fila do dia.
const LOTE = 10;
// Trecho que o Whisper acha que provavelmente é silêncio. Sem esse corte,
// silêncio vira frase inventada ("Obrigado por assistir").
const LIMITE_SEM_FALA = 0.8;

export interface TrechoWhisper {
  start: number;
  text: string;
  no_speech_prob?: number;
}

export interface Fala {
  inicio: number;
  quem: 'representante' | 'cliente';
  texto: string;
}

export interface Resumo {
  geral: string;
  pedido: string | null;
  objecoes: string | null;
  proximoPasso: string | null;
}

// Limite de pedidos do Groq: para a rodada sem gastar tentativa da
// gravação — a próxima rodada continua de onde parou.
class LimiteDoGroq extends Error {}

const ESQUEMA_RESPOSTA = {
  type: 'object',
  additionalProperties: false,
  required: ['falas', 'resumo'],
  properties: {
    falas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['trecho', 'quem'],
        properties: {
          trecho: { type: 'integer' },
          quem: { type: 'string', enum: ['representante', 'cliente'] },
        },
      },
    },
    resumo: {
      type: 'object',
      additionalProperties: false,
      required: ['geral', 'pedido', 'objecoes', 'proximoPasso'],
      properties: {
        geral: { type: 'string' },
        pedido: { type: ['string', 'null'] },
        objecoes: { type: ['string', 'null'] },
        proximoPasso: { type: ['string', 'null'] },
      },
    },
  },
} as const;

const INSTRUCOES = `Você recebe a transcrição de uma ligação comercial da Gama Brasil. De um lado está a representante (SDR) da Gama, que fez ou atendeu a ligação; do outro, o cliente ou possível cliente. Cada linha é um trecho numerado, no formato "[número] (minuto:segundo) texto".

1. Para CADA trecho, diga quem falou: "representante" (quem fala em nome da Gama, apresenta a empresa, faz as perguntas de qualificação) ou "cliente". Devolva um item por trecho, com o número dele.

2. Escreva o resumo em português do Brasil, frases curtas e objetivas, sem inventar nada que não esteja na conversa:
- geral: uma ou duas frases sobre o que foi a ligação.
- pedido: o que o cliente pediu ou demonstrou interesse; null se nada.
- objecoes: objeções ou dificuldades que o cliente levantou; null se nenhuma.
- proximoPasso: o que ficou combinado como próximo passo; null se nada ficou combinado.`;

@Injectable()
export class TranscricaoService {
  private readonly logger = new Logger(TranscricaoService.name);
  private rodando = false;
  private avisouSemChave = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron('*/5 * * * *', { name: 'telefonia-transcricao', unrefTimeout: true })
  async rodada(): Promise<void> {
    const chave = this.config.get<string>('groqApiKey');
    if (!chave) {
      if (!this.avisouSemChave) {
        this.logger.warn('Transcrição parada: GROQ_API_KEY não configurada.');
        this.avisouSemChave = true;
      }
      return;
    }
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.processarPendentes(chave);
    } catch (err) {
      // Nunca derruba o processo: a próxima rodada tenta de novo.
      this.logger.error(`Rodada de transcrição falhou: ${mensagem(err)}`);
    } finally {
      this.rodando = false;
    }
  }

  private async processarPendentes(chave: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });
    const ctx: TenantContext = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId: workspace.id,
      role: 'owner',
    };

    const fila = await this.tenantContext.run(ctx, (tx) =>
      tx.callRecording.findMany({
        where: { workspaceId: workspace.id, transcricaoStatus: 'pendente' },
        orderBy: { gravadoEm: 'asc' },
        take: LOTE,
        select: {
          id: true,
          storagePath: true,
          formato: true,
          tamanhoBytes: true,
          transcricaoTentativas: true,
        },
      }),
    );

    for (const gravacao of fila) {
      try {
        const dados = await this.transcrever(chave, gravacao);
        await this.tenantContext.run(ctx, (tx) =>
          tx.callRecording.update({
            where: { id: gravacao.id },
            data: {
              ...dados,
              transcricaoErro: null,
              transcritaEm: new Date(),
            },
          }),
        );
        this.logger.log(
          `Gravação ${gravacao.id} transcrita (${dados.transcricaoStatus}).`,
        );
      } catch (err) {
        if (err instanceof LimiteDoGroq) {
          this.logger.warn('Limite do Groq atingido; fila continua na próxima rodada.');
          return;
        }
        const tentativas = gravacao.transcricaoTentativas + 1;
        await this.tenantContext.run(ctx, (tx) =>
          tx.callRecording.update({
            where: { id: gravacao.id },
            data: {
              transcricaoTentativas: tentativas,
              transcricaoErro: mensagem(err).slice(0, 500),
              ...(tentativas >= MAX_TENTATIVAS
                ? { transcricaoStatus: 'erro' }
                : {}),
            },
          }),
        );
        this.logger.error(
          `Gravação ${gravacao.id}: transcrição falhou (tentativa ${tentativas}): ${mensagem(err)}`,
        );
      }
    }
  }

  private async transcrever(
    chave: string,
    gravacao: {
      id: string;
      storagePath: string;
      formato: string;
      tamanhoBytes: number;
    },
  ) {
    if (gravacao.tamanhoBytes > MAX_BYTES_GROQ) {
      throw new Error('Áudio maior que 25 MB, limite do Groq.');
    }
    const audio = await this.storage.download(
      gravacao.storagePath,
      GRAVACOES_BUCKET,
    );

    const form = new FormData();
    const tipo = gravacao.formato === 'wav' ? 'audio/wav' : 'audio/mpeg';
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: tipo }),
      `${gravacao.id}.${gravacao.formato}`,
    );
    form.append('model', MODELO_FALA);
    form.append('language', 'pt');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('prompt', 'Ligação comercial da Gama Brasil, em português do Brasil.');

    const fala = (await this.groq(chave, '/audio/transcriptions', {
      method: 'POST',
      body: form,
    })) as { duration?: number; segments?: TrechoWhisper[] };

    const trechos = trechosComFala(fala.segments ?? []);
    const duracaoSegundos =
      typeof fala.duration === 'number' ? Math.round(fala.duration) : null;
    if (trechos.length === 0) {
      return {
        transcricaoStatus: 'sem_fala',
        duracaoSegundos,
        transcricao: null,
        falas: Prisma.DbNull,
        resumo: Prisma.DbNull,
      };
    }

    const resposta = (await this.groq(chave, '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELO_RESUMO,
        temperature: 0,
        messages: [
          { role: 'system', content: INSTRUCOES },
          { role: 'user', content: linhasNumeradas(trechos) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ligacao',
            strict: true,
            schema: ESQUEMA_RESPOSTA,
          },
        },
      }),
    })) as { choices?: { message?: { content?: string } }[] };

    const conteudo = resposta.choices?.[0]?.message?.content;
    if (!conteudo) throw new Error('Resumo voltou vazio do Groq.');
    const lido = JSON.parse(conteudo) as {
      falas: { trecho: number; quem: Fala['quem'] }[];
      resumo: Resumo;
    };

    return {
      transcricaoStatus: 'concluida',
      duracaoSegundos,
      transcricao: trechos.map((t) => t.text.trim()).join(' '),
      falas: montarFalas(trechos, lido.falas) as unknown as Prisma.InputJsonValue,
      resumo: lido.resumo as unknown as Prisma.InputJsonValue,
    };
  }

  private async groq(
    chave: string,
    caminho: string,
    init: RequestInit,
  ): Promise<unknown> {
    const resposta = await fetch(`${GROQ_URL}${caminho}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(180_000),
    });
    if (resposta.status === 429) throw new LimiteDoGroq();
    if (!resposta.ok) {
      // O corpo de erro do Groq traz só a mensagem técnica — nunca o
      // conteúdo da conversa.
      const corpo = await resposta.text().catch(() => '');
      throw new Error(`Groq ${caminho} respondeu ${resposta.status}: ${corpo.slice(0, 300)}`);
    }
    return resposta.json();
  }
}

// Tira o que o Whisper marcou como provável silêncio e trecho vazio.
export function trechosComFala(trechos: TrechoWhisper[]): TrechoWhisper[] {
  return trechos.filter(
    (t) =>
      t.text.trim().length > 0 && (t.no_speech_prob ?? 0) < LIMITE_SEM_FALA,
  );
}

export function linhasNumeradas(trechos: TrechoWhisper[]): string {
  return trechos
    .map((t, i) => `[${i + 1}] (${minutoSegundo(t.start)}) ${t.text.trim()}`)
    .join('\n');
}

// Junta o texto literal do Whisper com o falante que o modelo indicou.
// Trecho que o modelo pulou herda o falante do anterior (fala longa
// quebrada em dois trechos é o caso comum); o primeiro, sem anterior, fica
// com a representante, que é quem abre a ligação.
export function montarFalas(
  trechos: TrechoWhisper[],
  indicados: { trecho: number; quem: Fala['quem'] }[],
): Fala[] {
  const porTrecho = new Map(indicados.map((f) => [f.trecho, f.quem]));
  let anterior: Fala['quem'] = 'representante';
  return trechos.map((t, i) => {
    const quem = porTrecho.get(i + 1) ?? anterior;
    anterior = quem;
    return { inicio: Math.round(t.start), quem, texto: t.text.trim() };
  });
}

function minutoSegundo(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
