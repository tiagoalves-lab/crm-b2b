import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../tenancy/tenant-context.service';
import type { Estabelecimento } from './egestor.types';

// Ponte entre o webhook do eGestor (este módulo) e o console fiscal
// (src/fiscal/), que é quem sabe gravar NF-e. O FiscalModule já importa o
// EgestorModule (auth, cliente HTTP); importar de volta criaria um ciclo
// de módulos — em vez disso, o console fiscal se registra aqui ao subir
// (FiscalNotasSyncService#onModuleInit) e o webhook só chama.

export interface ResultadoEventoNfe {
  // Chave curta gravada em egestor_webhook_events.process_result.
  resultado:
    | 'nfe_criada'
    | 'nfe_atualizada'
    | 'nfe_removida'
    | 'nfe_inexistente_ignorada'
    | 'nfe_homologacao_ignorada';
  numero: number | null;
  situacao: string | null;
}

export interface ProcessadorNfeWebhook {
  aplicarEventoNfe(
    ctx: TenantContext,
    estabelecimento: Estabelecimento,
    codigo: string,
    action: string,
  ): Promise<ResultadoEventoNfe>;
}

@Injectable()
export class EgestorNfeWebhookRegistry {
  private processador: ProcessadorNfeWebhook | null = null;

  registrar(processador: ProcessadorNfeWebhook): void {
    this.processador = processador;
  }

  obter(): ProcessadorNfeWebhook | null {
    return this.processador;
  }
}
