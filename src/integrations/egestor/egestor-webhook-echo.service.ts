import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../tenancy/tenant-context.service';
import type { Estabelecimento } from './egestor.types';

// Marcador de curta duração pra diferenciar "webhook por causa de uma
// escrita do PRÓPRIO CRM" de "webhook por causa de edição feita direto
// no eGestor" — confirmado contra a API real (2026-08-12) que as duas
// disparam o mesmo evento, sem campo de origem no payload que permita
// diferenciar de outro jeito. Ver docs/webhook-egestor.md.
@Injectable()
export class EgestorWebhookEchoService {
  // Folga generosa sobre a latência real observada em teste (evento
  // chegou em ~3s) — sem deixar o marcador vivo tempo demais (uma edição
  // legítima feita por um humano no mesmo código, minutos depois, não
  // deve ser tratada como eco).
  static readonly TTL_MS = 60_000;

  // Chamado logo após um PUT/POST bem-sucedido no eGestor
  // (EgestorContatoCorrectionService) — um `par` por `(estabelecimento,
  // codigo)` realmente escrito nesta operação (Consolidar/Corrigir SEFAZ
  // podem escrever nos dois lados de uma vez).
  async registrar(
    tx: TenantTx,
    workspaceId: string,
    pares: Array<{ estabelecimento: Estabelecimento; codigo: string }>,
  ): Promise<void> {
    if (pares.length === 0) return;
    const expiresAt = new Date(Date.now() + EgestorWebhookEchoService.TTL_MS);
    await tx.egestorWriteEcho.createMany({
      data: pares.map((par) => ({
        workspaceId,
        estabelecimento: par.estabelecimento,
        codigo: par.codigo,
        expiresAt,
      })),
    });
  }

  // Consome (apaga) o marcador se existir e ainda não tiver expirado —
  // one-shot, pra uma segunda edição legítima no mesmo código não ficar
  // suprimida por engano. Aproveita a chamada pra limpar marcadores já
  // expirados do mesmo (estabelecimento, codigo) — mantém a tabela
  // pequena sem precisar de um cron dedicado.
  async consumirSeEco(
    tx: TenantTx,
    workspaceId: string,
    estabelecimento: Estabelecimento,
    codigo: string,
  ): Promise<boolean> {
    const agora = new Date();

    const marcador = await tx.egestorWriteEcho.findFirst({
      where: { workspaceId, estabelecimento, codigo, expiresAt: { gt: agora } },
      orderBy: { createdAt: 'desc' },
    });

    await tx.egestorWriteEcho.deleteMany({
      where: {
        workspaceId,
        estabelecimento,
        codigo,
        expiresAt: { lte: agora },
      },
    });

    if (!marcador) return false;

    await tx.egestorWriteEcho.delete({ where: { id: marcador.id } });
    return true;
  }
}
