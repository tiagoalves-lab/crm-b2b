import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { EgestorInteractionOrigin } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import type { MembershipContext } from '../../tenancy/tenant-membership.guard';
import type { EgestorWebhookPayloadDto } from './dto/egestor-webhook-payload.dto';
import { EgestorCartaoCnpjService } from './egestor-cartao-cnpj.service';
import type {
  AplicarCorrecaoResult,
  CompletarResult,
} from './egestor-contato-correction.service';
import { EgestorInteractionLogService } from './egestor-interaction-log.service';
import { EgestorWebhookEchoService } from './egestor-webhook-echo.service';
import { EgestorWebhookProcessingService } from './egestor-webhook-processing.service';
import {
  descreverContato,
  descreverEmpresa,
  limparDocumento,
  nomeDaLinha,
  nomeDoEstabelecimento,
} from './egestor.types';
import type { Estabelecimento } from './egestor.types';

// Mesmo workspace único do resto do projeto (ver
// tenant-membership.guard.ts) — a rota do webhook é pública (sem JWT),
// então resolve direto por slug em vez de vir de um MembershipContext.
const DEFAULT_WORKSPACE_SLUG = 'gama';

// Ator "sistema" pra `app.current_user_id`/`app.current_role` (RLS) quando
// não há membership real por trás da escrita — o eGestor chama esta rota
// sem login Supabase nenhum. `role: 'owner'` de propósito: é o que faz
// `CompanyService.remove()` (usado na reconciliação, via
// EgestorContatoSyncService) passar pela checagem de autorização sem
// depender de um Membership de verdade existir com este id (ver
// PolicyService#can — owner/admin sempre tem acesso, sem consultar
// ownership). Não pode ser o UUID nil (todo-zero): `TenantContextService#run`
// valida formato estrito de UUID v1-5 — versão/variante setadas
// manualmente pra passar, resto zerado.
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

// Handler operacional do webhook de contatos (2026-08-12; regra de
// hierarquia recalibrada em 2026-08-13 — ver docs/webhook-egestor.md,
// seção "Correção da regra de hierarquia"). Quatro fases:
// 1. tx curta — dedupe do evento (retry do eGestor até 5x, mesmo evento
//    pode chegar mais de uma vez) + checagem de eco (a própria escrita do
//    CRM também dispara webhook, confirmado contra a API real — ver
//    EgestorWebhookEchoService). Se já processado ou for eco, encerra
//    aqui, sem chamada de rede nenhuma.
// 2. Fora de tx — busca o contato fresco no eGestor (GET), só quando
//    action !== 'deleted'.
// 3. UMA tx só, do início da decisão até o fim da persistência — segura
//    um advisory lock por contato (`pg_advisory_xact_lock`) o tempo
//    todo: decide se há divergência, aplica a correção automática no
//    eGestor se houver (direção evento → outro lado, regra 2
//    recalibrada — sem hierarquia fixa Matriz/Filial), registra eco,
//    promove/atualiza ou reconcilia a Company, marca processado. O lock
//    garante que dois eventos quase simultâneos do MESMO contato (Matriz
//    e Filial editadas quase juntas) sejam aplicados na ordem de
//    chegada — o segundo espera o primeiro liberar antes de ler o
//    estado, senão os dois leriam "o antigo" ao mesmo tempo e um
//    sobrescreveria a correção do outro no espelho.
//
//    Exceção deliberada à convenção "network nunca dentro de tx" do
//    resto do módulo: a correção automática (GET+PUT no eGestor) roda
//    dentro desta tx quando há divergência — só assim o lock cobre a
//    decisão inteira. Aceitável neste fluxo específico: processa um
//    contato por vez, volume baixo, timeout generoso (30s, mesmo usado
//    alhures no módulo).
// 4. Fora de tx — Cartão CNPJ da Receita Federal na empresa que acabou
//    de ser promovida (`EgestorCartaoCnpjService`, 2026-08-19). O
//    eGestor não tem situação cadastral/CNAE/porte/natureza jurídica, que
//    é o que a aba "Dados cadastrais" da ficha mostra; sem esta fase a
//    empresa nova nascia com a aba vazia até alguém clicar em "Buscar
//    dados" na mão. Única fase que NÃO propaga erro (ver abaixo): o
//    cadastro já entrou, o Cartão CNPJ é enriquecimento — Receita fora do
//    ar não pode fazer o eGestor reenviar o evento.
//
// Erro nas fases 1-3 propaga (nunca é engolido) — o controller deixa
// virar 500, e o próprio mecanismo de retry do eGestor (até 5x) dá uma
// nova chance; o evento fica com `processedAt` nulo até dar certo.
@Injectable()
export class EgestorWebhookService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly echo: EgestorWebhookEchoService,
    private readonly processing: EgestorWebhookProcessingService,
    private readonly interactionLog: EgestorInteractionLogService,
    private readonly cartaoCnpj: EgestorCartaoCnpjService,
  ) {}

  // Comparação em tempo constante — não é senha de usuário, mas é o único
  // jeito de provar que a requisição veio do eGestor de verdade (doc não
  // documenta assinatura HMAC, só esse token fixo por conta). Vale a
  // mesma cautela.
  assertValidToken(estabelecimento: Estabelecimento, token: string): void {
    const expected =
      estabelecimento === 'matriz'
        ? this.config.get<string>('egestorWebhookSecurityTokenMatriz')
        : this.config.get<string>('egestorWebhookSecurityTokenFilial');

    if (!expected) {
      throw new UnauthorizedException(
        `EGESTOR_WEBHOOK_SECURITY_TOKEN_${estabelecimento.toUpperCase()} não configurado.`,
      );
    }

    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (!valid) {
      throw new UnauthorizedException('securityToken inválido.');
    }
  }

  async handleEvent(
    estabelecimento: Estabelecimento,
    payload: EgestorWebhookPayloadDto,
  ): Promise<{ processResult: string }> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { slug: DEFAULT_WORKSPACE_SLUG },
      select: { id: true },
    });
    const workspaceId = workspace.id;
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };
    const membership: MembershipContext = {
      id: SYSTEM_ACTOR_USER_ID,
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner',
      status: 'active',
    };

    const dataEgestor = parseDataEgestor(payload.date);
    const codigo = String(payload.codigo);
    // `securityToken` NUNCA entra no log — é o mesmo segredo que autentica
    // os próximos webhooks dessa conta (docs/seguranca.md: nenhum segredo
    // em texto legível fora do `.env`). O resto do payload não tem nada
    // sensível (só action/codigo/date/module).
    const { securityToken: _securityToken, ...payloadSemToken } = payload;

    // Fase 1 — dedupe + eco, tudo dentro de uma única tx curta (sem
    // chamada de rede).
    const decisao = await this.tenantContext.run(ctx, async (tx) => {
      let evento = await tx.egestorWebhookEvent.findFirst({
        where: {
          workspaceId,
          estabelecimento,
          module: payload.module,
          codigoExterno: codigo,
          action: payload.action,
          dataEgestor,
        },
      });

      if (!evento) {
        evento = await tx.egestorWebhookEvent.create({
          data: {
            workspaceId,
            estabelecimento,
            module: payload.module,
            action: payload.action,
            codigoExterno: codigo,
            dataEgestor,
            rawPayload: payloadSemToken,
          },
        });
      }

      // Retry do eGestor pro mesmo evento já TOTALMENTE processado —
      // nada a fazer de novo (diferente de um evento já logado mas ainda
      // com `processedAt` nulo, que É reprocessado, ver comentário na
      // migration).
      if (evento.processedAt) {
        return {
          eventoId: evento.id,
          encerrar: true as const,
          processResult: evento.processResult ?? 'ja_processado',
        };
      }

      // Escopo atual: só o módulo "contatos" tem pipeline de
      // processamento (Vendas/Produtos/Usuários/Financeiro nem estão
      // habilitados no cadastro do webhook, ver docs/webhook-egestor.md).
      if (payload.module !== 'contatos') {
        await tx.egestorWebhookEvent.update({
          where: { id: evento.id },
          data: {
            processedAt: new Date(),
            processResult: 'modulo_nao_suportado',
          },
        });
        return {
          eventoId: evento.id,
          encerrar: true as const,
          processResult: 'modulo_nao_suportado',
        };
      }

      const ehEco = await this.echo.consumirSeEco(
        tx,
        workspaceId,
        estabelecimento,
        codigo,
      );
      if (ehEco) {
        await tx.egestorWebhookEvent.update({
          where: { id: evento.id },
          data: { processedAt: new Date(), processResult: 'eco_ignorado' },
        });
        // Este ramo encerra ANTES da busca do contato fresco (fase 2), então
        // a razão social só pode vir do espelho — uma consulta a mais por
        // eco, custo desprezível no volume de webhooks e o que faz esta
        // linha do histórico ficar tão legível quanto as outras.
        const espelho = await tx.egestorContatoConsolidado.findFirst({
          where:
            estabelecimento === 'matriz'
              ? { workspaceId, codigoMatriz: codigo }
              : { workspaceId, codigoFilial: codigo },
          select: { nomeMatriz: true, nomeFilial: true },
        });

        await this.interactionLog.registrar(tx, workspaceId, {
          origin: origemDoEstabelecimento(estabelecimento),
          action: 'webhook_eco_ignorado',
          summary: `Webhook contatos.${payload.action} recebido (${descreverContato(
            codigo,
            espelho ? nomeDaLinha(espelho) : null,
            estabelecimento,
          )}) — ignorado por ser eco da própria escrita do CRM (nenhuma tabela alterada).`,
        });
        return {
          eventoId: evento.id,
          encerrar: true as const,
          processResult: 'eco_ignorado',
        };
      }

      return { eventoId: evento.id, encerrar: false as const };
    });

    if (decisao.encerrar) {
      return { processResult: decisao.processResult };
    }

    // Fase 2 — fora de tx, chamada de rede pro eGestor.
    const contatoFresco = await this.processing.buscarContatoFresco(
      estabelecimento,
      payload.action,
      codigo,
    );

    // Chave do lock por contato (regra 5, ver comentário da classe): CNPJ
    // quando dá (contato ainda existe, é o identificador universal entre
    // as duas contas) — senão (action === 'deleted', contatoFresco nulo)
    // cai pro par estabelecimento+codigo, que só protege esse evento
    // contra si mesmo (janela residual conhecida: uma exclusão numa
    // conta correndo junto com uma edição do MESMO cnpj na outra conta
    // não compartilha lock — combinação rara, aceita por ora).
    const chaveLock = contatoFresco
      ? limparDocumento(contatoFresco.cpfcnpj)
      : `${estabelecimento}:${codigo}`;

    // Fase 3 — uma tx só (decisão + correção automática + persistência),
    // com o lock do contato segurado do início ao fim.
    const processResult = await this.tenantContext.run(
      ctx,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chaveLock})::bigint)`;

        const plano = await this.processing.planejarEvento(
          tx,
          workspaceId,
          estabelecimento,
          payload.action,
          codigo,
          contatoFresco,
        );

        const resultadoCorrecao =
          plano.tipo === 'corrigir_divergencia'
            ? await this.processing.aplicarCorrecaoAutomatica(
                plano.row,
                plano.direcao,
              )
            : undefined;

        // Regra 6 (2026-08-13) — completa automaticamente o lado que
        // falta (so_matriz/so_filial), reaproveitando a mesma escrita no
        // eGestor do botão manual "Completar Matriz ⇄ Filial".
        const resultadoCompletar =
          plano.tipo === 'completar_lado_faltante'
            ? await this.processing.aplicarCompletarAutomatico(plano.row)
            : undefined;

        if (resultadoCorrecao) {
          await this.echo.registrar(tx, workspaceId, [
            {
              estabelecimento: resultadoCorrecao.estabelecimentoEscrito,
              codigo: resultadoCorrecao.codigoEscrito,
            },
          ]);
        }
        if (resultadoCompletar) {
          // Código NOVO (criado agora), não um dos já existentes na
          // linha — mesmo racional do endpoint manual de completar.
          await this.echo.registrar(tx, workspaceId, [
            {
              estabelecimento: resultadoCompletar.estabelecimentoEscrito,
              codigo: resultadoCompletar.codigoNovo,
            },
          ]);
        }

        const resultado = await this.processing.finalizarEvento(
          tx,
          workspaceId,
          membership,
          plano,
          resultadoCorrecao,
          resultadoCompletar,
        );
        await tx.egestorWebhookEvent.update({
          where: { id: decisao.eventoId },
          data: { processedAt: new Date(), processResult: resultado },
        });
        // Razão social pro histórico (2026-08-17): prefere o nome que
        // acabou de vir do eGestor, que é o mais atual; cai pro espelho
        // quando não houve contato pra buscar (action 'deleted') e some
        // de vez quando nem linha no espelho existe (evento sem CNPJ).
        const nomeParaLog =
          (typeof contatoFresco?.nome === 'string'
            ? contatoFresco.nome
            : null) ??
          (plano.tipo === 'sem_cnpj' ? null : nomeDaLinha(plano.row));

        await this.interactionLog.registrar(tx, workspaceId, {
          origin: origemDoEstabelecimento(estabelecimento),
          action: 'webhook_processado',
          summary: construirResumoWebhook(
            estabelecimento,
            payload.action,
            codigo,
            resultadoCorrecao,
            resultadoCompletar,
            resultado,
            nomeParaLog,
          ),
        });
        return resultado;
      },
      { timeoutMs: 30_000 },
    );

    // Fase 4 — Cartão CNPJ da Receita na empresa promovida (ver
    // comentário da classe). Só quando o evento de fato levou a uma
    // Company (promoção nova ou vínculo com cadastro que já existia): nos
    // demais resultados (`sem_cnpj_ignorado`, `nao_e_cliente_*`,
    // `desativada_*`) não há ficha pra preencher.
    if (contatoFresco && RESULTADOS_COM_COMPANY.has(processResult)) {
      await this.preencherCartaoCnpj(
        ctx,
        membership,
        workspaceId,
        estabelecimento,
        limparDocumento(contatoFresco.cpfcnpj),
      );
    }

    return { processResult };
  }

  // Isolada num método próprio pra deixar explícito que NADA aqui pode
  // derrubar o webhook: o `catch` de rede/BrasilAPI já mora dentro do
  // EgestorCartaoCnpjService, e a gravação do histórico (banco) é
  // protegida aqui. O cadastro do eGestor já entrou; falhar em enriquecer
  // com a Receita não pode virar 500 e fazer o eGestor reenviar o evento.
  private async preencherCartaoCnpj(
    ctx: { userId: string; workspaceId: string; role: 'owner' },
    membership: MembershipContext,
    workspaceId: string,
    estabelecimento: Estabelecimento,
    cpfCnpj: string,
  ): Promise<void> {
    try {
      const linha = await this.tenantContext.run(ctx, (tx) =>
        tx.egestorContatoConsolidado.findFirst({
          where: { workspaceId, cpfCnpj },
          select: { companyId: true, nomeMatriz: true, nomeFilial: true },
        }),
      );
      if (!linha?.companyId) return;

      const resultado = await this.cartaoCnpj.preencherSeFaltando(
        ctx,
        membership,
        linha.companyId,
      );
      // "Já tinha" / "sem CNPJ" / "sem company" são o caminho silencioso
      // do dia a dia (todo webhook de empresa já cadastrada cai aqui) —
      // registrar isso encheria o histórico de linha sem informação.
      if (resultado.status !== 'preenchido' && resultado.status !== 'erro') {
        return;
      }

      const empresa = descreverEmpresa(
        cpfCnpj,
        nomeDaLinha({
          nomeMatriz: linha.nomeMatriz,
          nomeFilial: linha.nomeFilial,
        }),
      );
      await this.tenantContext.run(ctx, (tx) =>
        this.interactionLog.registrar(tx, workspaceId, {
          origin: origemDoEstabelecimento(estabelecimento),
          action:
            resultado.status === 'preenchido'
              ? 'cartao_cnpj_preenchido'
              : 'cartao_cnpj_erro',
          summary:
            resultado.status === 'preenchido'
              ? `Cartão CNPJ da Receita Federal consultado automaticamente para a empresa recém-cadastrada ${empresa} — aba "Dados cadastrais" preenchida (situação cadastral, CNAE, porte e natureza jurídica), tabela companies atualizada${
                  resultado.camposAtualizados.length > 0
                    ? ` (campo(s) [${resultado.camposAtualizados.join(', ')}] ajustado(s) pelo dado oficial)`
                    : ''
                }${
                  resultado.emailsFonesConflito
                    ? '; e-mail/telefone da Receita divergem do que já estava no CRM — o dado do CRM foi preservado, revisar manualmente'
                    : ''
                }.`
              : `Falha ao consultar o Cartão CNPJ da Receita Federal para a empresa ${empresa} — cadastro do eGestor entrou normalmente, só a aba "Dados cadastrais" ficou vazia (nenhuma tabela alterada). Motivo: ${resultado.motivo}.`,
        }),
      );
    } catch {
      // Enriquecimento é acessório — nem o histórico dele pode derrubar o
      // processamento do evento, que a esta altura já foi concluído e
      // marcado como processado.
    }
  }
}

// Resultados de `EgestorWebhookProcessingService#finalizarEvento` em que
// existe uma Company por trás do contato — os únicos em que faz sentido
// buscar o Cartão CNPJ (fase 4).
const RESULTADOS_COM_COMPANY = new Set([
  'company_criada',
  'vinculada_a_company_existente',
  'divergencia_corrigida_e_atualizada',
  'lado_faltante_completado_e_atualizada',
  'atualizada',
]);

function origemDoEstabelecimento(
  estabelecimento: Estabelecimento,
): EgestorInteractionOrigin {
  return estabelecimento === 'matriz' ? 'egestor_matriz' : 'egestor_filial';
}

// Monta o texto legível da coluna "Ações realizadas" do histórico
// (EgestorInteractionLog) a partir do resultado do processamento
// operacional do webhook — nomes/valores de `resultado` vêm de
// EgestorWebhookProcessingService#finalizarEvento, ver comentário lá.
function construirResumoWebhook(
  estabelecimento: Estabelecimento,
  action: string,
  codigo: string,
  resultadoCorrecao: AplicarCorrecaoResult | undefined,
  resultadoCompletar: CompletarResult | undefined,
  resultado: string,
  // Razão social da empresa por trás do código (pedido do usuário,
  // 2026-08-17) — o número sozinho não dizia de qual empresa era a linha.
  // Opcional porque nem todo evento tem contato pra consultar: em
  // `contatos.deleted` o registro já não existe mais no eGestor.
  nome?: string | null,
): string {
  const cabecalho = `Webhook contatos.${action} recebido (${descreverContato(codigo, nome, estabelecimento)})`;

  const correcao = resultadoCorrecao
    ? `divergência detectada e corrigida automaticamente — campo(s) [${resultadoCorrecao.camposCorrigidos.join(', ')}] propagado(s) via PUT no eGestor ${nomeDoEstabelecimento(resultadoCorrecao.estabelecimentoEscrito)} (${descreverContato(resultadoCorrecao.codigoEscrito, nome)}), tabela egestor_contatos_consolidado atualizada; `
    : '';

  const completar = resultadoCompletar
    ? `contato existia só num lado — criado automaticamente via POST no eGestor ${nomeDoEstabelecimento(resultadoCompletar.estabelecimentoEscrito)} (${descreverContato(resultadoCompletar.codigoNovo, nome)}), tabela egestor_contatos_consolidado atualizada; `
    : '';

  const efeito: Record<string, string> = {
    sem_cnpj_ignorado: 'contato sem CNPJ, ignorado (nenhuma tabela alterada).',
    nao_e_cliente_nunca_rastreado:
      'contato não é cliente e nunca foi rastreado (nenhuma tabela alterada).',
    desativada_nao_e_mais_cliente:
      'contato deixou de ser cliente — Company desativada (soft-delete reversível, tabela companies) e linha removida da tabela egestor_contatos_consolidado.',
    removida_do_espelho_nunca_promovida:
      'contato não é mais cliente — linha removida da tabela egestor_contatos_consolidado (nunca tinha sido promovida a Company).',
    company_criada:
      'contato promovido — Company nova criada (tabela companies).',
    vinculada_a_company_existente:
      'contato promovido — vinculado a Company já existente (tabela companies).',
    divergencia_corrigida_e_atualizada:
      'tabela egestor_contatos_consolidado atualizada.',
    lado_faltante_completado_e_atualizada:
      'tabela egestor_contatos_consolidado atualizada.',
    atualizada: 'tabela egestor_contatos_consolidado atualizada.',
  };

  if (
    resultado.startsWith('erro_ao_desativar') ||
    resultado.startsWith('erro_ao_promover')
  ) {
    return `${cabecalho} — ${correcao}${completar}erro no processamento: ${resultado}.`;
  }

  return `${cabecalho} — ${correcao}${completar}${efeito[resultado] ?? resultado}`;
}

// "yyyy-mm-dd HH:mm:ss" (ver exemplo em docs/webhook-egestor.md) — não é
// ISO 8601, `new Date()` direto nesse formato depende de parsing
// não-padrão do motor JS. Troca o espaço por "T" pra ficar parseável de
// forma confiável.
function parseDataEgestor(date: string): Date {
  const isoLike = date.includes('T') ? date : date.replace(' ', 'T');
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data do webhook eGestor inválida: "${date}".`);
  }
  return parsed;
}
