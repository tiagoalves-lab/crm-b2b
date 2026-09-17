import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// API transacional do Resend (decisão de arquitetura do plano de reports,
// 2026-09-15). Chamada por `fetch` em vez do SDK `resend` pelo mesmo
// critério já aplicado ao eGestor/Meta/BrasilAPI: o corpo é um JSON de
// quatro campos, e uma dependência a menos é uma superfície a menos pra
// auditar (docs/seguranca.md, gatilho "dependência nova"). O cabeçalho
// `Idempotency-Key` — que no SDK é um parâmetro separado, variável por
// versão — aqui vai explícito, sem depender de assinatura de biblioteca.
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Teto do provedor: no máximo 50 endereços por envio. O report vai num
// e-mail só pra toda a lista (1 envio/dia contra a cota), então este
// número só vira problema se a Gama passar de 50 gestores — aí o envio é
// quebrado em lotes aqui dentro, não no chamador.
const MAX_DESTINATARIOS = 50;

export interface EnvioParams {
  to: string[];
  subject: string;
  html: string;
  // Trava do lado do provedor contra envio duplicado (expira em 24h, o
  // que casa com a cadência diária). A trava primária é o índice único de
  // report_log; esta cobre a janela entre montar o e-mail e gravar o log.
  idempotencyKey?: string;
}

export interface EnvioResultado {
  ok: boolean;
  id?: string;
  error?: string;
}

// Wrapper fino sobre o provedor de envio. Duas regras que não mudam:
//
// 1. Remetente e "responder para" vêm SEMPRE do ambiente — quem chama
//    escolhe destinatário/assunto/corpo, nunca de quem o e-mail parece
//    ter vindo. É o que impede um chamador futuro de enviar em nome de
//    outro domínio.
// 2. Nunca lança. Todo erro volta como `{ ok: false, error }` porque o
//    chamador é um job agendado: exceção não tratada num @Cron derruba o
//    ciclo sem deixar rastro legível.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  // Sem chave/remetente configurados o envio é desligado, não quebrado —
  // mesmo critério das outras integrações do projeto (o CRM sobe e
  // funciona inteiro sem isso; só o report não sai, e o motivo fica no
  // log e no report_log).
  get configurado(): boolean {
    return Boolean(
      this.config.get<string>('resendApiKey') &&
        this.config.get<string>('mailFrom'),
    );
  }

  async send(params: EnvioParams): Promise<EnvioResultado> {
    const apiKey = this.config.get<string>('resendApiKey');
    const from = this.config.get<string>('mailFrom');
    const replyTo = this.config.get<string>('mailReplyTo');

    if (!apiKey || !from) {
      return {
        ok: false,
        error:
          'Envio de e-mail não configurado (RESEND_API_KEY/MAIL_FROM ausentes).',
      };
    }

    const destinatarios = [
      ...new Set(
        params.to.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0),
      ),
    ];
    if (destinatarios.length === 0) {
      return { ok: false, error: 'Nenhum destinatário válido.' };
    }
    if (destinatarios.length > MAX_DESTINATARIOS) {
      return {
        ok: false,
        error: `Mais de ${MAX_DESTINATARIOS} destinatários num envio só (${destinatarios.length}).`,
      };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (params.idempotencyKey) {
      // Limite do provedor: 256 caracteres. As chaves deste projeto têm
      // ~30, o corte é só defesa contra um tipo de report futuro com nome
      // longo.
      headers['Idempotency-Key'] = params.idempotencyKey.slice(0, 256);
    }

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from,
          to: destinatarios,
          ...(replyTo ? { reply_to: replyTo } : {}),
          subject: params.subject,
          html: params.html,
        }),
      });

      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        // A resposta de erro do provedor pode ecoar o cabeçalho enviado —
        // nunca interpolar `apiKey` aqui.
        const detalhe =
          body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : JSON.stringify(body);
        return { ok: false, error: `HTTP ${res.status}: ${detalhe}` };
      }

      const id =
        body && typeof body === 'object' && 'id' in body
          ? String((body as { id: unknown }).id)
          : undefined;
      return { ok: true, id };
    } catch (err) {
      // Rede fora, DNS, timeout: o job precisa continuar e gravar a falha.
      const mensagem = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha de rede ao enviar e-mail: ${mensagem}`);
      return { ok: false, error: mensagem };
    }
  }
}
