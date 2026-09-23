import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { TelefoniaDevice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TenantContextService,
  type TenantTx,
} from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import type { CriarDispositivoDto } from './dto/criar-dispositivo.dto';

const DEFAULT_WORKSPACE_SLUG = 'gama';
const PREFIXO_TOKEN = 'gama-fone_';

export interface DispositivoAutenticado {
  workspaceId: string;
  userId: string;
  deviceId: string;
}

// Credencial da máquina que roda o script do MicroSIP. Guardada só como
// hash: o valor em claro existe uma única vez, na resposta da criação —
// perdeu, gera outra. Mesma disciplina de qualquer segredo do projeto
// (docs/seguranca.md).
@Injectable()
export class TelefoniaDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async criar(
    tx: TenantTx,
    membership: MembershipContext,
    dto: CriarDispositivoDto,
  ): Promise<{ dispositivo: TelefoniaDevice; token: string }> {
    const donoPretendido = dto.userId ?? membership.userId;
    const ehChefe = membership.role === 'owner' || membership.role === 'admin';
    if (donoPretendido !== membership.userId && !ehChefe) {
      throw new ForbiddenException(
        'Só um administrador gera credencial para outra pessoa.',
      );
    }
    if (donoPretendido !== membership.userId) {
      const alvo = await tx.membership.findFirst({
        where: {
          workspaceId: membership.workspaceId,
          userId: donoPretendido,
          status: 'active',
        },
        select: { id: true },
      });
      if (!alvo) throw new NotFoundException('Membro não encontrado.');
    }

    const token = `${PREFIXO_TOKEN}${randomBytes(24).toString('hex')}`;
    const dispositivo = await tx.telefoniaDevice.create({
      data: {
        workspaceId: membership.workspaceId,
        userId: donoPretendido,
        nome: dto.nome.trim(),
        tokenHash: hash(token),
      },
    });
    return { dispositivo, token };
  }

  async listar(
    tx: TenantTx,
    membership: MembershipContext,
  ): Promise<TelefoniaDevice[]> {
    const ehChefe = membership.role === 'owner' || membership.role === 'admin';
    return tx.telefoniaDevice.findMany({
      where: {
        workspaceId: membership.workspaceId,
        ...(ehChefe ? {} : { userId: membership.userId }),
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  async revogar(
    tx: TenantTx,
    membership: MembershipContext,
    id: string,
  ): Promise<TelefoniaDevice> {
    const dispositivo = await tx.telefoniaDevice.findFirst({
      where: { id, workspaceId: membership.workspaceId },
    });
    const ehChefe = membership.role === 'owner' || membership.role === 'admin';
    if (!dispositivo || (!ehChefe && dispositivo.userId !== membership.userId)) {
      throw new NotFoundException('Credencial não encontrada.');
    }
    return tx.telefoniaDevice.update({
      where: { id: dispositivo.id },
      data: { revogadoEm: new Date() },
    });
  }

  // Autenticação do script: o header Authorization traz o token em claro,
  // e é ele que diz de quem é a chamada. Sem membership, sem JWT — por
  // isso a rota é @Public (mesma disciplina do webhook da planilha do
  // Meta, com o controle substituto testado).
  async autenticar(
    authorization: string | undefined,
  ): Promise<DispositivoAutenticado> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !token.startsWith(PREFIXO_TOKEN)) {
      throw new UnauthorizedException('Credencial do computador inválida.');
    }

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { slug: DEFAULT_WORKSPACE_SLUG },
      select: { id: true },
    });

    const dispositivo = await this.tenantContext.run(
      { userId: SYSTEM_USER_ID, workspaceId: workspace.id, role: 'owner' },
      (tx) =>
        tx.telefoniaDevice.findFirst({
          where: {
            workspaceId: workspace.id,
            tokenHash: hash(token),
            revogadoEm: null,
          },
        }),
    );
    if (!dispositivo) {
      throw new UnauthorizedException('Credencial do computador inválida.');
    }

    // Marca de uso: é o que a tela mostra pra dizer se aquela máquina está
    // mesmo conversando com o CRM ("último sinal há 3 minutos") — a forma
    // do usuário perceber instalação quebrada sem ninguém investigar.
    await this.tenantContext.run(
      { userId: dispositivo.userId, workspaceId: workspace.id, role: 'owner' },
      (tx) =>
        tx.telefoniaDevice.update({
          where: { id: dispositivo.id },
          data: { ultimoUsoEm: new Date() },
        }),
    );

    return {
      workspaceId: workspace.id,
      userId: dispositivo.userId,
      deviceId: dispositivo.id,
    };
  }
}

// Mesmo ator de sistema usado pelas integrações (contextoSistema, em
// meta-leads-webhook.service.ts): identifica escrita feita pelo servidor,
// sem gente logada por trás.
const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000000';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
