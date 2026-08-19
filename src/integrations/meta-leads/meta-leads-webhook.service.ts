import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Prisma } from '@prisma/client';
import { ContactService } from '../../companies/contact.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RawLeadService } from '../../raw-leads/raw-lead.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import type { MetaLeadsWebhookPayloadDto } from './dto/meta-leads-webhook-payload.dto';
import { MetaGraphService } from './meta-graph.service';
import { mapearLeadDoMeta } from './meta-lead-mapper';
import {
  parseCreatedTime,
  type MetaLeadgenChangeValue,
} from './meta-leads.types';

// Mesmo workspace único do resto do projeto (ver tenant-membership.guard.ts)
// — a rota do webhook é pública (sem JWT), então resolve direto por slug.
const DEFAULT_WORKSPACE_SLUG = 'gama';

// Ator "sistema" pra `app.current_user_id`/`app.current_role` (RLS) nas
// escritas da tabela de eventos, que não têm membership real por trás (é a
// Meta chamando, sem login Supabase nenhum). Mesmo UUID/mesmo racional do
// EgestorWebhookService — não pode ser o UUID nil porque
// TenantContextService#run valida formato estrito de UUID v1-5.
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

export interface ProcessamentoResultado {
  leadgenId: string;
  resultado: string;
}

// Handler do webhook `leadgen` da Central de Leads do Meta Business Suite
// (docs/webhook-meta-leads.md). Três fases por lead recebido:
//
// 1. tx curta — dedupe do evento por `leadgen_id` (a Meta reenvia em retry
//    quando a resposta não vem a tempo/vem erro). Evento com `processedAt`
//    já setado encerra aqui, sem chamada de rede nenhuma.
// 2. Fora de tx — `GET /{leadgen_id}` na Graph API pra buscar as respostas
//    do formulário (o webhook manda só o id, ver MetaGraphService).
// 3. tx — cria o RawLead (+ Contact da pessoa que preencheu, quando dá) e
//    marca o evento processado.
//
// Erro em qualquer fase propaga (nunca é engolido) — o controller deixa
// virar 500 e a própria Meta reenvia, dando nova chance ao evento (que fica
// com `processedAt` nulo até dar certo). Mesma disciplina "sem fila/cron"
// já usada e testada no webhook eGestor.
//
// Diferente do eGestor, este módulo NUNCA escreve de volta na Meta (a
// Central de Leads é fonte, não destino) — por isso não existe mecanismo de
// eco aqui: nada que o CRM faça pode disparar um evento de volta.
@Injectable()
export class MetaLeadsWebhookService {
  private readonly logger = new Logger(MetaLeadsWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly graph: MetaGraphService,
    private readonly rawLeads: RawLeadService,
    private readonly contacts: ContactService,
  ) {}

  // Handshake de verificação da assinatura (GET) — a Meta só aceita a URL
  // depois de receber o `hub.challenge` de volta, cru, provando que quem
  // atende conhece o `hub.verify_token` combinado no cadastro.
  verificarHandshake(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    const esperado = this.config.get<string>('metaVerifyToken');
    if (!esperado) {
      throw new UnauthorizedException('META_VERIFY_TOKEN não configurado.');
    }
    if (mode !== 'subscribe' || !challenge) {
      throw new UnauthorizedException('Handshake inválido.');
    }
    if (!compararSegredo(token ?? '', esperado)) {
      throw new UnauthorizedException('hub.verify_token inválido.');
    }
    return challenge;
  }

  // Assinatura HMAC-SHA256 do corpo CRU com o App Secret — é o que prova
  // que o evento veio da Meta (equivalente ao `securityToken` do webhook
  // eGestor). Precisa ser dos bytes exatos recebidos: recalcular a partir
  // do objeto já parseado daria outro digest a qualquer diferença de
  // espaçamento/ordem de chaves (ver `rawBody: true` em main.ts).
  assertAssinaturaValida(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
  ): void {
    const appSecret = this.config.get<string>('metaAppSecret');
    if (!appSecret) {
      throw new UnauthorizedException('META_APP_SECRET não configurado.');
    }
    if (!rawBody) {
      throw new UnauthorizedException(
        'Corpo cru indisponível — assinatura não pode ser verificada.',
      );
    }
    const prefixo = 'sha256=';
    if (!signatureHeader?.startsWith(prefixo)) {
      throw new UnauthorizedException(
        'X-Hub-Signature-256 ausente ou mal formado.',
      );
    }

    const esperado = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    if (!compararSegredo(signatureHeader.slice(prefixo.length), esperado)) {
      throw new UnauthorizedException('Assinatura inválida.');
    }
  }

  async handleEvent(
    payload: MetaLeadsWebhookPayloadDto,
  ): Promise<ProcessamentoResultado[]> {
    const mudancas = extrairMudancasLeadgen(payload);
    if (mudancas.length === 0) {
      return [];
    }

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { slug: DEFAULT_WORKSPACE_SLUG },
      select: { id: true },
    });
    const workspaceId = workspace.id;

    const resultados: ProcessamentoResultado[] = [];
    for (const mudanca of mudancas) {
      resultados.push(await this.processarLead(workspaceId, mudanca));
    }
    return resultados;
  }

  private async processarLead(
    workspaceId: string,
    valor: MetaLeadgenChangeValue,
  ): Promise<ProcessamentoResultado> {
    const leadgenId = String(valor.leadgen_id);
    const ctxSistema = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };

    // Fase 1 — dedupe, tx curta sem chamada de rede.
    const decisao = await this.tenantContext.run(ctxSistema, async (tx) => {
      const existente = await tx.metaLeadsWebhookEvent.findFirst({
        where: { workspaceId, leadgenId },
      });
      if (existente?.processedAt) {
        return {
          eventoId: existente.id,
          encerrar: true as const,
          resultado: existente.processResult ?? 'ja_processado',
        };
      }
      if (existente) {
        return { eventoId: existente.id, encerrar: false as const };
      }

      const evento = await tx.metaLeadsWebhookEvent.create({
        data: {
          workspaceId,
          pageId: String(valor.page_id ?? ''),
          formId: valor.form_id != null ? String(valor.form_id) : null,
          adId: valor.ad_id != null ? String(valor.ad_id) : null,
          leadgenId,
          createdTimeMeta: parseCreatedTime(valor.created_time) ?? null,
          rawPayload: valor as unknown as Prisma.InputJsonValue,
        },
      });
      return { eventoId: evento.id, encerrar: false as const };
    });

    if (decisao.encerrar) {
      return { leadgenId, resultado: decisao.resultado };
    }

    // Fase 2 — fora de tx, chamada de rede pra Graph API.
    const detalhe = await this.graph.buscarLead(leadgenId);
    const leadPayload = detalhe as unknown as Prisma.InputJsonValue;

    // Dono do lead: o gerente configurado (decisão do usuário, 2026-08-14 —
    // ver docs/roadmap.md, decisões 1.2/1.3). Sem isso configurado, guarda
    // o payload buscado e para por aqui SEM marcar processado: responde 200
    // (a Meta não precisa reenviar, o dado já está salvo) e o evento fica
    // pendente pra reprocessar quando a variável for configurada. Falhar
    // com 500 aqui só geraria retry infinito por um problema de config, que
    // retry nenhum resolve.
    const owner = await this.resolverOwner(workspaceId);
    if (!owner) {
      this.logger.warn(
        `Lead ${leadgenId} recebido mas META_LEADS_DEFAULT_OWNER_USER_ID não aponta pra um membro ativo — RawLead não criado.`,
      );
      await this.tenantContext.run(ctxSistema, (tx) =>
        tx.metaLeadsWebhookEvent.update({
          where: { id: decisao.eventoId },
          data: { leadPayload, processResult: 'owner_nao_configurado' },
        }),
      );
      return { leadgenId, resultado: 'owner_nao_configurado' };
    }

    const { rawLead, contato, camposNaoMapeados } = mapearLeadDoMeta(
      detalhe,
      leadgenId,
    );
    if (camposNaoMapeados.length > 0) {
      // Não é erro — só sinaliza que o formulário faz pergunta que o DE-PARA
      // ainda não conhece (docs/roadmap.md, dúvida 1.4). A resposta inteira
      // fica gravada em `leadPayload`, nada se perde.
      this.logger.log(
        `Lead ${leadgenId}: campo(s) sem mapeamento — ${camposNaoMapeados.join(', ')}`,
      );
    }

    // Fase 3 — cria o lead na carteira do gerente. Roda sob o contexto DELE
    // (não do ator sistema): RawLeadService#create usa `membership.userId`
    // como `ownerUserId` do RawLead e da Company, e a RLS lê o mesmo
    // `app.current_user_id`/`app.current_role` — é isso que faz o lead
    // nascer já na carteira certa em vez de órfão.
    const resultado = await this.tenantContext.run(
      {
        userId: owner.userId,
        workspaceId,
        role: owner.role,
      },
      async (tx) => {
        const lead = await this.rawLeads.create(tx, owner, rawLead);

        if (contato && lead.promotedCompanyId) {
          await this.contacts.create(tx, owner, lead.promotedCompanyId, {
            nome: contato.nome,
            email: contato.email,
            telefone: contato.telefone,
            cargo: contato.cargo,
          });
        }

        await tx.metaLeadsWebhookEvent.update({
          where: { id: decisao.eventoId },
          data: {
            leadPayload,
            rawLeadId: lead.id,
            processedAt: new Date(),
            processResult: contato
              ? 'raw_lead_e_contato_criados'
              : 'raw_lead_criado',
          },
        });

        return contato ? 'raw_lead_e_contato_criados' : 'raw_lead_criado';
      },
      // Cria RawLead + Company + Contact + update do evento numa transação
      // só — mesmo motivo do timeout estendido do import de planilha (o
      // default de 5s do Prisma é curto pra várias idas ao banco em
      // sequência).
      { timeoutMs: 15_000 },
    );

    return { leadgenId, resultado };
  }

  // Gerente dono de todo lead do Meta. Devolve o Membership real (não um
  // contexto fabricado) pra que papel/permissões/hierarquia sejam os de
  // verdade — PolicyService lê `id` pra resolver subordinados e
  // `permissions` pra capacidade.
  private async resolverOwner(
    workspaceId: string,
  ): Promise<MembershipContext | null> {
    const userId = this.config.get<string>('metaLeadsDefaultOwnerUserId');
    if (!userId) return null;

    const membership = await this.tenantContext.run(
      { userId: SYSTEM_ACTOR_USER_ID, workspaceId, role: 'owner' },
      (tx) =>
        tx.membership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId } },
        }),
    );
    if (!membership || membership.status !== 'active') return null;

    return {
      id: membership.id,
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
      status: membership.status,
      permissions: membership.permissions,
    };
  }
}

// Comparação em tempo constante — mesmo cuidado do `securityToken` do
// webhook eGestor. `timingSafeEqual` exige buffers do mesmo tamanho, daí a
// checagem de comprimento antes (que vaza só o tamanho, não o conteúdo).
function compararSegredo(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Um POST da Meta pode trazer várias entries e várias changes (ela agrupa
// eventos quando chegam quase juntos) — achata tudo, ficando só com o que é
// `leadgen` e tem `leadgen_id` legível. Qualquer outro campo assinado no
// futuro é ignorado em silêncio aqui, não rejeitado.
function extrairMudancasLeadgen(
  payload: MetaLeadsWebhookPayloadDto,
): MetaLeadgenChangeValue[] {
  const out: MetaLeadgenChangeValue[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      const valor = change.value as unknown as MetaLeadgenChangeValue;
      const leadgenId = valor?.leadgen_id;
      if (leadgenId === undefined || leadgenId === null) continue;
      if (String(leadgenId).trim() === '') continue;
      out.push(valor);
    }
  }
  return out;
}
