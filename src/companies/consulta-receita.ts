import { BadRequestException, NotFoundException } from '@nestjs/common';

// Consulta pública (sem chave/custo) da base da Receita Federal. Fonte
// principal: BrasilAPI. Reserva: OpenCNPJ — em 2026-10-08 a BrasilAPI
// passou a devolver 500 ("Request failed with status code 503", falha na
// fonte DELA) pra CNPJs fora do cache dela, travando o cadastro, enquanto
// a OpenCNPJ respondia o mesmo CNPJ normalmente. A reserva só entra quando
// a principal está fora do ar (5xx, timeout, rede) — 404 e CNPJ inválido
// são resposta de verdade e voltam direto pro usuário.
//
// A resposta da OpenCNPJ é convertida pro formato da BrasilAPI, então quem
// mapeia pro cadastro (CompanyService#lookupCnpj) não sabe de onde veio.

// Formato de resposta da BrasilAPI (https://brasilapi.com.br/api/cnpj/v1) —
// só os campos que a gente de fato usa, o resto da resposta é ignorado.
export interface ReceitaCnpjResponse {
  razao_social?: string;
  nome_fantasia?: string;
  email?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  // A Receita guarda o TIPO do logradouro separado do nome: "AVENIDA" +
  // "BRASIL", nunca "AVENIDA BRASIL" num campo só. Ver montarLogradouro.
  descricao_tipo_de_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  // Código numérico (2 = ATIVA) — o texto vem em
  // `descricao_situacao_cadastral`, ver o mapeamento em lookupCnpj.
  situacao_cadastral?: number;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  porte?: string;
  descricao_porte?: string;
  natureza_juridica?: string;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  cnaes_secundarios?: Array<{ codigo?: number; descricao?: string }>;
  descricao_identificador_matriz_filial?: string;
}

// Formato da OpenCNPJ (https://api.opencnpj.org/{cnpj}), conferido contra
// a resposta real em 2026-10-08. Diferenças pra BrasilAPI: situação, porte
// e matriz/filial vêm em caixa mista ("Ativa"), CNAE vem como texto, e os
// telefones vêm numa lista com fax misturado.
interface OpenCnpjResponse {
  razao_social?: string;
  nome_fantasia?: string;
  situacao_cadastral?: string;
  matriz_filial?: string;
  data_inicio_atividade?: string;
  cnaes?: Array<{
    codigo?: string;
    descricao?: string;
    is_principal?: boolean;
  }>;
  natureza_juridica?: string;
  tipo_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  uf?: string;
  municipio?: string;
  email?: string;
  telefones?: Array<{ ddd?: string; numero?: string; is_fax?: boolean }>;
  porte_empresa?: string;
}

// BrasilAPI levou ~5 s pra devolver o erro no incidente; sem teto, uma
// fonte travada segura o clique do usuário indefinidamente.
const TIMEOUT_MS = 10_000;

const MENSAGEM_FORA_DO_AR =
  'A consulta à Receita Federal está fora do ar agora — tente novamente em instantes ou preencha os dados manualmente.';

// Sem User-Agent/Accept, o fetch parece tráfego de bot anônimo — a
// proteção do Vercel/Cloudflare na frente da BrasilAPI bloqueia com
// 403 (`x-vercel-mitigated: deny`) antes mesmo de chegar na API de
// verdade. Descoberto rodando de dentro do Railway (2026-08-01) — de
// fora (curl local) o mesmo CNPJ respondia 200 normalmente.
const HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; CRM-Gama-Brasil/1.0; +https://web-gamma-olive-80.vercel.app)',
};

// Sinaliza "a fonte está fora do ar, tente a próxima" — distinto das
// exceções HTTP, que são a resposta final pro usuário.
class FonteIndisponivel extends Error {}

async function buscar(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new FonteIndisponivel(String(err));
  }
}

async function consultarBrasilApi(
  digits: string,
): Promise<ReceitaCnpjResponse> {
  const response = await buscar(
    `https://brasilapi.com.br/api/cnpj/v1/${digits}`,
  );
  if (response.status === 404) {
    throw new NotFoundException(`CNPJ "${digits}" não encontrado.`);
  }
  if (response.status >= 500 || response.status === 429) {
    throw new FonteIndisponivel(`BrasilAPI respondeu ${response.status}`);
  }
  if (!response.ok) {
    // BrasilAPI manda um `message` específico (ex.: "CNPJ 11.111.111/1111-11
    // inválido." quando o dígito verificador não bate) — repassa em vez de
    // esconder atrás de um texto genérico, senão "CNPJ digitado errado"
    // parece erro de infra e ninguém sabe o que corrigir.
    const body: unknown = await response.json().catch(() => null);
    if (body && typeof body === 'object' && 'message' in body) {
      throw new BadRequestException(String(body.message));
    }
    throw new FonteIndisponivel(`BrasilAPI respondeu ${response.status}`);
  }
  return (await response.json()) as ReceitaCnpjResponse;
}

async function consultarOpenCnpj(digits: string): Promise<ReceitaCnpjResponse> {
  const response = await buscar(`https://api.opencnpj.org/${digits}`);
  if (response.status === 404) {
    throw new NotFoundException(`CNPJ "${digits}" não encontrado.`);
  }
  if (!response.ok) {
    throw new FonteIndisponivel(`OpenCNPJ respondeu ${response.status}`);
  }
  return converterOpenCnpj((await response.json()) as OpenCnpjResponse);
}

export function converterOpenCnpj(d: OpenCnpjResponse): ReceitaCnpjResponse {
  const maiusculo = (v?: string) => (v ? v.toUpperCase() : undefined);
  const principal = d.cnaes?.find((c) => c.is_principal);
  const fones = (d.telefones ?? [])
    .filter((t) => !t.is_fax && t.numero)
    .map((t) => `${t.ddd ?? ''}${t.numero}`);
  return {
    razao_social: d.razao_social,
    nome_fantasia: d.nome_fantasia || undefined,
    email: d.email || undefined,
    ddd_telefone_1: fones[0],
    ddd_telefone_2: fones[1],
    descricao_tipo_de_logradouro: d.tipo_logradouro || undefined,
    logradouro: d.logradouro,
    numero: d.numero,
    complemento: d.complemento || undefined,
    bairro: d.bairro,
    cep: d.cep,
    municipio: d.municipio,
    uf: d.uf,
    // A tela compara com "ATIVA"; a OpenCNPJ manda "Ativa".
    descricao_situacao_cadastral: maiusculo(d.situacao_cadastral),
    data_inicio_atividade: d.data_inicio_atividade,
    porte: maiusculo(d.porte_empresa),
    natureza_juridica: d.natureza_juridica,
    cnae_fiscal: principal?.codigo ? Number(principal.codigo) : undefined,
    cnae_fiscal_descricao: principal?.descricao,
    cnaes_secundarios: (d.cnaes ?? [])
      .filter((c) => !c.is_principal)
      .map((c) => ({
        codigo: c.codigo ? Number(c.codigo) : undefined,
        descricao: c.descricao,
      })),
    descricao_identificador_matriz_filial: maiusculo(d.matriz_filial),
  };
}

export async function consultarReceita(
  digits: string,
): Promise<ReceitaCnpjResponse> {
  for (const fonte of [consultarBrasilApi, consultarOpenCnpj]) {
    try {
      return await fonte(digits);
    } catch (err) {
      if (!(err instanceof FonteIndisponivel)) throw err;
      console.warn(
        `[consulta-receita] ${err.message} — tentando a próxima fonte`,
      );
    }
  }
  throw new BadRequestException(MENSAGEM_FORA_DO_AR);
}
