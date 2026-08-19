import { Injectable } from '@nestjs/common';
import type {
  EgestorInteractionLog,
  EgestorInteractionOrigin,
} from '@prisma/client';
import type { TenantTx } from '../../tenancy/tenant-context.service';

// Histórico legível por humano de TODA interação da integração eGestor
// (docs/roadmap.md, "Criar log das interações de requisições de API",
// 2026-08-13) — alimenta o botão "Histórico de requisições" da tela
// Integração eGestor. Motivo direto do usuário: falta de confiança de que
// o CRM como "orquestrador" (correção automática via webhook, ver
// docs/webhook-egestor.md) está de fato fazendo o que diz que faz.
//
// Diferente de EgestorWebhookEvent (log CRU de cada evento recebido, pra
// dedupe/reprocessamento): aqui é uma linha por EFEITO real (campo
// corrigido, Company criada, contato promovido, sincronização rodada...),
// cobrindo tanto o processamento automático do webhook quanto as ações
// manuais da tela (Sincronizar/Promover/Corrigir/Consolidar/Corrigir com
// SEFAZ/Completar), que nunca passam pelo webhook.
//
// Serviço deliberadamente burro (mesmo espírito de EgestorWebhookEchoService):
// só grava/lista, cada call site decide o `summary` (texto livre pronto pra
// tela, já em português) e a `action` (chave curta pra filtro futuro).
@Injectable()
export class EgestorInteractionLogService {
  async registrar(
    tx: TenantTx,
    workspaceId: string,
    entrada: {
      origin: EgestorInteractionOrigin;
      action: string;
      summary: string;
    },
  ): Promise<void> {
    await tx.egestorInteractionLog.create({
      data: {
        workspaceId,
        origin: entrada.origin,
        action: entrada.action,
        summary: entrada.summary,
      },
    });
  }

  // Sem paginação de verdade (mesmo critério do resto do módulo — busca
  // tudo, filtra/ordena no client) — volume esperado é baixo (uma linha
  // por ação/evento processado, não por request HTTP cru).
  async listar(
    tx: TenantTx,
    workspaceId: string,
  ): Promise<EgestorInteractionLog[]> {
    return tx.egestorInteractionLog.findMany({
      where: { workspaceId },
      orderBy: { occurredAt: 'desc' },
    });
  }
}
