import { ConflictException } from '@nestjs/common';

// 409, não 412 — convenção mais comum em APIs REST/Nest pra "alguém mudou
// isso desde que você leu". Corpo inclui currentVersion pra o cliente
// decidir entre recarregar e tentar de novo.
export class OptimisticConcurrencyException extends ConflictException {
  constructor(currentVersion: number) {
    super({
      message:
        'O registro foi alterado por outra atualização — recarregue e tente novamente.',
      currentVersion,
    });
  }
}
