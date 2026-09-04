import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import type {
  MetaLeadsPlanilhaLinhaDto,
  MetaLeadsPlanilhaPayloadDto,
} from './dto/meta-leads-planilha-payload.dto';
import {
  MetaLeadsWebhookService,
  compararSegredo,
  contextoSistema,
  type ContextoCaptura,
  type ProcessamentoResultado,
} from './meta-leads-webhook.service';
import {
  COLUNAS_METADADOS_PLANILHA,
  type MetaLeadDetail,
} from './meta-leads.types';

// Canal por onde os leads do Meta chegam hoje (2026-09-04): enquanto o App
// no Meta for Developers não sai do modo desenvolvimento (política de
// privacidade pendente, ver docs/webhook-meta-leads.md), o gestor de
// tráfego exporta a Central de Leads pra uma planilha do Google Sheets, e
// um script instalado nela (scripts/planilha-meta-leads.gs) manda cada
// linha nova pra cá.
//
// A planilha é SÓ porta de entrada (diretriz do usuário, 2026-09-04): o
// CRM copia a linha na chegada e, dali em diante, a ficha vive no CRM —
// alteração posterior na planilha não muda nada aqui, e cada lead entra uma
// única vez (dedupe pelo id que a Meta dá ao lead, mesma chave do webhook
// direto).
//
// Reaproveita a fase 3 do MetaLeadsWebhookService (criarLeadNoCrm): mesma
// tabela de eventos, mesmo mapeador, mesma carteira do gerente, mesma
// anotação na Timeline. A única diferença é a fase 2 — aqui não há
// chamada à Graph API, as respostas já vêm na linha.
@Injectable()
export class MetaLeadsPlanilhaService {
  private readonly logger = new Logger(MetaLeadsPlanilhaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextService,
    private readonly webhook: MetaLeadsWebhookService,
  ) {}

  // Controle substituto do login na rota @Public() (decisão 4.5 do
  // docs/seguranca.md): token estático no Authorization, comparado em
  // tempo constante — mesmo molde do CotacoesService#assertTokenValido.
  // As mensagens distinguem qual camada recusou (teste em idor.e2e-spec.ts
  // confere a mensagem exata pra provar que foi a comparação do token).
  assertTokenValido(authorizationHeader: string | undefined): void {
    const esperado = this.config.get<string>('metaLeadsPlanilhaToken');
    if (!esperado) {
      throw new UnauthorizedException(
        'META_LEADS_PLANILHA_TOKEN não configurado.',
      );
    }
    const prefixo = 'Bearer ';
    if (!authorizationHeader?.startsWith(prefixo)) {
      throw new UnauthorizedException('Authorization ausente ou mal formado.');
    }
    if (!compararSegredo(authorizationHeader.slice(prefixo.length), esperado)) {
      throw new UnauthorizedException('Token inválido.');
    }
  }

  async receber(
    payload: MetaLeadsPlanilhaPayloadDto,
  ): Promise<ProcessamentoResultado[]> {
    if (!payload.linhas?.length) return [];

    const workspaceId = await this.webhook.resolverWorkspaceId();

    const resultados: ProcessamentoResultado[] = [];
    for (const linha of payload.linhas) {
      resultados.push(await this.processarLinha(workspaceId, linha));
    }
    return resultados;
  }

  private async processarLinha(
    workspaceId: string,
    linha: MetaLeadsPlanilhaLinhaDto,
  ): Promise<ProcessamentoResultado> {
    const campos = normalizarCampos(linha.campos);
    const leadgenId = semPrefixo(linha.id) || semPrefixo(campos.get('id'));
    if (!leadgenId) {
      return { leadgenId: '', resultado: 'linha_sem_id' };
    }

    const ctxSistema = contextoSistema(workspaceId);
    const teste = ehLeadDeTeste(campos);

    // Fase 1 — dedupe + registro cru, tx curta. Lead de teste da Meta
    // (botão "Testar" do formulário) é registrado já como processado, pra
    // nunca virar linha na Prospecção e pra não ser reavaliado a cada
    // envio do script.
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
          origem: 'planilha',
          pageId: null,
          formId: semPrefixo(campos.get('form_id')) || null,
          adId: semPrefixo(campos.get('ad_id')) || null,
          leadgenId,
          createdTimeMeta: parseIso(campos.get('created_time')),
          rawPayload: linha as unknown as Prisma.InputJsonValue,
          ...(teste
            ? {
                processedAt: new Date(),
                processResult: 'lead_de_teste_ignorado',
              }
            : {}),
        },
      });
      return {
        eventoId: evento.id,
        encerrar: teste,
        resultado: 'lead_de_teste_ignorado',
      };
    });

    if (decisao.encerrar) {
      return { leadgenId, resultado: decisao.resultado };
    }

    // Fase 2 — sem rede: monta o mesmo formato do `GET /{leadgen_id}` a
    // partir da linha, pra entrar no mesmo mapeador do webhook. Só o que é
    // resposta do formulário vira `field_data`; metadado do anúncio vai no
    // contexto da anotação.
    const detalhe: MetaLeadDetail = {
      id: leadgenId,
      created_time: campos.get('created_time'),
      ad_id: semPrefixo(campos.get('ad_id')) || undefined,
      form_id: semPrefixo(campos.get('form_id')) || undefined,
      field_data: [...campos.entries()]
        .filter(([nome]) => !COLUNAS_METADADOS_PLANILHA.has(nome))
        .map(([name, value]) => ({
          name,
          values: [name === 'phone_number' ? semPrefixo(value) : value],
        })),
    };
    const contexto: ContextoCaptura = {
      plataforma: plataformaLegivel(campos.get('platform')),
      formulario: campos.get('form_name'),
      campanha: campos.get('campaign_name'),
      anuncio: campos.get('ad_name'),
    };

    const resultado = await this.webhook.criarLeadNoCrm(
      workspaceId,
      decisao.eventoId,
      leadgenId,
      detalhe,
      contexto,
    );
    this.logger.log(`Linha ${leadgenId} da planilha: ${resultado}`);
    return { leadgenId, resultado };
  }
}

// Cabeçalho da planilha → chave minúscula e aparada; valor → string
// aparada. Célula vazia some do mapa (o mapeador já ignora valor vazio,
// mas aqui também evita mandar "" pro contexto da anotação).
function normalizarCampos(
  campos: Record<string, unknown>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [chave, valor] of Object.entries(campos ?? {})) {
    const nome = chave.trim().toLowerCase();
    if (!nome) continue;
    const texto = valorComoTexto(valor);
    if (!texto) continue;
    map.set(nome, texto);
  }
  return map;
}

function valorComoTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  return '';
}

// O export da Central de Leads prefixa os ids com o tipo ("l:" lead, "ag:"
// anúncio, "as:" conjunto, "c:" campanha, "f:" formulário) e o telefone com
// "p:". Só o que vem depois dos dois-pontos interessa.
function semPrefixo(valor: string | undefined): string {
  const texto = valor?.trim() ?? '';
  return texto.replace(/^[a-z]{1,3}:/i, '').trim();
}

// Lead de teste gerado pelo botão "Testar" do formulário no Meta Business
// Suite: todo campo vem como "<test lead: dummy data for ...>" e o e-mail é
// test@meta.com. O script já filtra antes de mandar; conferir de novo aqui
// custa nada e protege contra script antigo/diferente.
function ehLeadDeTeste(campos: Map<string, string>): boolean {
  if (campos.get('email')?.toLowerCase() === 'test@meta.com') return true;
  for (const valor of campos.values()) {
    if (valor.toLowerCase().includes('<test lead')) return true;
  }
  return false;
}

function parseIso(valor: string | undefined): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function plataformaLegivel(valor: string | undefined): string | undefined {
  const codigo = valor?.toLowerCase();
  if (!codigo) return undefined;
  if (codigo === 'ig') return 'Instagram';
  if (codigo === 'fb') return 'Facebook';
  return valor;
}
