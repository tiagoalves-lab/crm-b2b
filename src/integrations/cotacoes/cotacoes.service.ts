import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Company } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TenantContextService,
  type TenantTx,
} from '../../tenancy/tenant-context.service';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { UpsertClienteDto } from './dto/upsert-cliente.dto';

// Mesmos sentinelas do webhook do Meta (meta-leads-webhook.service.ts):
// integração é sempre do workspace da Gama, e o ator é o usuário-sistema.
const DEFAULT_WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';

const PAGE_SIZE_PADRAO = 200;

// Folga da marca d'água devolvida ao app de cotações: uma company alterada
// enquanto a varredura paginada roda pode ter updated_at menor que o fim da
// varredura sem ter entrado em nenhuma página. Recuar 5 min faz a varredura
// seguinte repescar esse intervalo — o upsert do espelho é idempotente,
// reprocessar de novo não custa nada.
const MARCA_DAGUA_FOLGA_MS = 5 * 60 * 1000;

export interface CompanyParaCotacoes {
  id: string;
  cnpj: string;
  razao_social: string | null;
  fantasia: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  indicador_ie: string | null;
  inscricao_estadual: string | null;
  atualizado_em: string;
}

@Injectable()
export class CotacoesService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // Controle substituto do login nas rotas @Public() deste módulo (decisão
  // 4.5 do docs/seguranca.md): token estático no Authorization, comparado
  // em tempo constante — mesmo molde do securityToken do webhook eGestor.
  // As mensagens distinguem qual camada recusou (teste em idor.e2e-spec.ts
  // confere a mensagem exata pra provar que foi a comparação do token).
  assertTokenValido(authorizationHeader: string | undefined): void {
    const esperado = this.config.get<string>('cotacoesApiToken');
    if (!esperado) {
      throw new UnauthorizedException('COTACOES_API_TOKEN não configurado.');
    }
    const prefixo = 'Bearer ';
    if (!authorizationHeader?.startsWith(prefixo)) {
      throw new UnauthorizedException('Authorization ausente ou mal formado.');
    }
    const recebido = authorizationHeader.slice(prefixo.length);
    const a = Buffer.from(recebido);
    const b = Buffer.from(esperado);
    const valido = a.length === b.length && timingSafeEqual(a, b);
    if (!valido) {
      throw new UnauthorizedException('Token inválido.');
    }
  }

  // Varredura paginada pro espelho de clientes do app de cotações.
  // Company-lead em triagem (tag "lead-triagem") fica de fora — não é
  // empresa de verdade até ser aprovada, mesmo critério da tela Empresas.
  async listCompanies(query: ListCompaniesQueryDto): Promise<{
    itens: CompanyParaCotacoes[];
    proxima_pagina: number | null;
    agora: string;
  }> {
    const pagina = query.pagina ?? 1;
    const tamanho = query.tamanho ?? PAGE_SIZE_PADRAO;
    const workspaceId = await this.workspaceId();

    const rows = await this.tenantContext.run(
      this.ctxSistema(workspaceId),
      (tx) =>
        tx.company.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            cpfCnpj: { not: null },
            NOT: { tags: { has: 'lead-triagem' } },
            ...(query.desde
              ? { updatedAt: { gt: new Date(query.desde) } }
              : {}),
          },
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          skip: (pagina - 1) * tamanho,
          // Uma linha a mais só pra saber se existe próxima página.
          take: tamanho + 1,
        }),
    );

    const temMais = rows.length > tamanho;
    const itens = (temMais ? rows.slice(0, tamanho) : rows).map((c) =>
      this.paraCotacoes(c),
    );
    return {
      itens,
      proxima_pagina: temMais ? pagina + 1 : null,
      agora: new Date(Date.now() - MARCA_DAGUA_FOLGA_MS).toISOString(),
    };
  }

  // Cadastro vindo do app de cotações (regra 3.10 das regras de negócio):
  // entra direto em Empresas, sem tag nenhuma (o selo "Tipo" derivado das
  // tags mostra Lead), sem passar pela Prospecção. Quem envia não consulta
  // antes — a reconciliação por CNPJ é daqui: se a empresa já existe,
  // devolve a existente sem sobrescrever nada.
  async upsertCliente(dto: UpsertClienteDto): Promise<{
    company: CompanyParaCotacoes;
    ja_existia: boolean;
  }> {
    const workspaceId = await this.workspaceId();

    return this.tenantContext.run(this.ctxSistema(workspaceId), async (tx) => {
      // Edição de cliente já vinculado: atualiza a company apontada.
      if (dto.crm_company_id) {
        const atual = await tx.company.findFirst({
          where: { id: dto.crm_company_id, workspaceId },
        });
        if (!atual || atual.deletedAt) {
          throw new NotFoundException('Empresa não encontrada.');
        }
        const salvo = await tx.company.update({
          where: { id: atual.id },
          data: {
            cpfCnpj: dto.cnpj,
            razaoSocial: dto.razao_social,
            fantasia: vazioViraNull(dto.fantasia),
            logradouro: vazioViraNull(dto.logradouro),
            numero: vazioViraNull(dto.numero),
            complemento: vazioViraNull(dto.complemento),
            bairro: vazioViraNull(dto.bairro),
            cidade: vazioViraNull(dto.cidade),
            uf: vazioViraNull(dto.uf),
            cep: vazioViraNull(dto.cep),
            customFields: mesclarCamposFiscais(
              atual.customFields,
              dto,
            ) as Prisma.InputJsonValue,
          },
        });
        return { company: this.paraCotacoes(salvo), ja_existia: true };
      }

      // Mesma function SECURITY DEFINER que o CompanyService usa pra
      // dedupe — companies.cpf_cnpj não tem unicidade no banco, a
      // reconciliação é da aplicação.
      const existenteId = await this.findCompanyIdByCnpj(
        tx,
        workspaceId,
        dto.cnpj,
      );
      if (existenteId) {
        const existente = await tx.company.findFirst({
          where: { id: existenteId, workspaceId },
        });
        if (existente && !existente.deletedAt) {
          return {
            company: this.paraCotacoes(existente),
            ja_existia: true,
          };
        }
      }

      const criada = await tx.company.create({
        data: {
          workspaceId,
          cpfCnpj: dto.cnpj,
          razaoSocial: dto.razao_social,
          fantasia: vazioViraNull(dto.fantasia),
          logradouro: vazioViraNull(dto.logradouro),
          numero: vazioViraNull(dto.numero),
          complemento: vazioViraNull(dto.complemento),
          bairro: vazioViraNull(dto.bairro),
          cidade: vazioViraNull(dto.cidade),
          uf: vazioViraNull(dto.uf),
          cep: vazioViraNull(dto.cep),
          customFields: mesclarCamposFiscais(
            null,
            dto,
          ) as Prisma.InputJsonValue,
          dtCad: new Date(),
        },
      });
      return { company: this.paraCotacoes(criada), ja_existia: false };
    });
  }

  private async findCompanyIdByCnpj(
    tx: TenantTx,
    workspaceId: string,
    cnpjDigits: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string | null }>>(
      Prisma.sql`SELECT public.find_company_id_by_cnpj(${workspaceId}::uuid, ${cnpjDigits}) AS id`,
    );
    return rows[0]?.id ?? null;
  }

  private async workspaceId(): Promise<string> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { slug: DEFAULT_WORKSPACE_SLUG },
      select: { id: true },
    });
    return workspace.id;
  }

  private ctxSistema(workspaceId: string) {
    return {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId,
      role: 'owner' as const,
    };
  }

  private paraCotacoes(c: Company): CompanyParaCotacoes {
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    return {
      id: c.id,
      cnpj: (c.cpfCnpj ?? '').replace(/\D/g, ''),
      razao_social: c.razaoSocial,
      fantasia: c.fantasia,
      logradouro: c.logradouro,
      numero: c.numero,
      complemento: c.complemento,
      bairro: c.bairro,
      cidade: c.cidade,
      uf: c.uf,
      cep: c.cep,
      indicador_ie: textoOuNull(cf['indicador_ie']),
      inscricao_estadual: textoOuNull(cf['inscricao_estadual']),
      atualizado_em: c.updatedAt.toISOString(),
    };
  }
}

function vazioViraNull(valor: string | undefined): string | null {
  const t = (valor ?? '').trim();
  return t.length > 0 ? t : null;
}

// indicador_ie/inscricao_estadual moram em companies.custom_fields (mesmas
// chaves do eGestor — egestor-contato-correction.service.ts). Merge por cima
// do que a company já tem pra preservar as demais chaves (cnpj_lookup etc.).
// Campo ausente no DTO não mexe na chave; enviado vazio remove (write-through:
// o formulário da cotação é a verdade, limpar lá limpa aqui).
function mesclarCamposFiscais(
  atuais: Prisma.JsonValue | null | undefined,
  dto: UpsertClienteDto,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    atuais && typeof atuais === 'object' && !Array.isArray(atuais)
      ? { ...(atuais as Record<string, unknown>) }
      : {};
  for (const chave of ['indicador_ie', 'inscricao_estadual'] as const) {
    const valor = dto[chave];
    if (valor === undefined) continue;
    const t = valor.trim();
    if (t.length > 0) base[chave] = t;
    else delete base[chave];
  }
  return base;
}

// custom_fields é jsonb livre — só string/número contam como valor; objeto,
// array ou boolean ali seria dado corrompido e vira null (nunca
// "[object Object]" no espelho).
function textoOuNull(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const t = String(valor).trim();
  return t.length > 0 ? t : null;
}
