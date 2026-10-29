import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PolicyService } from '../policy/policy.service';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { MembershipContext } from '../tenancy/tenant-membership.guard';
import { COMPANY_REF_SELECT } from '../companies/company-ref';
import type { CompanyRef } from '../companies/company-ref';
import type { ContatosQueryDto } from './dto/contatos-query.dto';
import { periodoBrasilia } from './periodo-brasilia';

// Mais alto que os outros relatórios: este é o que vira planilha (CSV), e
// a agenda inteira do workspace cabe folgada aqui.
const LIMITE = 10000;

export interface ContatoRelatorioRow {
  id: string;
  nome: string;
  cargo: string | null;
  email: string | null;
  telefone: string | null;
  decisor: boolean;
  ownerUserId: string | null;
  createdAt: string;
  company: (CompanyRef & { cpfCnpj: string | null }) | null;
}

export interface ContatosRelatorio {
  rows: ContatoRelatorioRow[];
  total: number;
  truncado: boolean;
}

// Relatório "Contatos" (pedido do usuário, 2026-09-28): a agenda de
// contatos de todas as empresas, com exportação para CSV na tela.
//
// Visibilidade: a mesma da aba Contatos da ficha (ContactService#list) —
// módulo "contatos" + escopo por dono do contato (scopeFilter). O filtro
// do formulário só estreita. Empresa excluída fica de fora, como na lista
// de Empresas.
@Injectable()
export class ContatosRelatorioService {
  constructor(private readonly policy: PolicyService) {}

  async gerar(
    tx: TenantTx,
    membership: MembershipContext,
    query: ContatosQueryDto,
  ): Promise<ContatosRelatorio> {
    if (!this.policy.canModule(membership, 'contatos', 'ver')) {
      throw new ForbiddenException('Sem permissão para ver contatos.');
    }
    if (!!query.inicio !== !!query.fim) {
      throw new BadRequestException('Informe a data inicial e a final.');
    }
    const periodo =
      query.inicio && query.fim ? periodoBrasilia(query.inicio, query.fim) : null;

    const scope = await this.policy.scopeFilter(tx, membership);
    const empresa = query.empresa?.trim();
    const contato = query.contato?.trim();
    // Telefone é gravado sem pontuação na maior parte da base — busca por
    // "(11) 9999" precisa casar com "119999".
    const contatoDigitos = contato?.replace(/\D/g, '');

    const where: Prisma.ContactWhereInput = {
      workspaceId: membership.workspaceId,
      company: {
        deletedAt: null,
        ...(empresa
          ? {
              OR: [
                { razaoSocial: { contains: empresa, mode: 'insensitive' } },
                { fantasia: { contains: empresa, mode: 'insensitive' } },
                { nomeParaContato: { contains: empresa, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      AND: [
        ...(scope.ownerUserId !== undefined ? [{ ownerUserId: scope.ownerUserId }] : []),
        ...(query.usuarioId ? [{ ownerUserId: query.usuarioId }] : []),
        ...(contato
          ? [
              {
                OR: [
                  { nome: { contains: contato, mode: 'insensitive' as const } },
                  { email: { contains: contato, mode: 'insensitive' as const } },
                  { telefone: { contains: contato } },
                  ...(contatoDigitos && contatoDigitos !== contato
                    ? [{ telefone: { contains: contatoDigitos } }]
                    : []),
                ],
              },
            ]
          : []),
      ],
      ...(query.decisor ? { decisor: query.decisor === 'sim' } : {}),
      ...(periodo ? { createdAt: { gte: periodo.de, lte: periodo.ate } } : {}),
    };

    const [total, contatos] = await Promise.all([
      tx.contact.count({ where }),
      tx.contact.findMany({
        where,
        // Agenda: agrupada por empresa, contatos em ordem alfabética.
        orderBy: [{ company: { razaoSocial: 'asc' } }, { nome: 'asc' }],
        take: LIMITE,
        include: {
          company: { select: { ...COMPANY_REF_SELECT, cpfCnpj: true } },
        },
      }),
    ]);

    return {
      rows: contatos.map((c) => ({
        id: c.id,
        nome: c.nome,
        cargo: c.cargo,
        email: c.email,
        telefone: c.telefone,
        decisor: c.decisor,
        ownerUserId: c.ownerUserId,
        createdAt: c.createdAt.toISOString(),
        company: c.company,
      })),
      total,
      truncado: total > LIMITE,
    };
  }
}
