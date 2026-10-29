import type { Estabelecimento } from '../integrations/egestor/egestor.types';
import type { TenantTx } from '../tenancy/tenant-context.service';
import type { NfeXmlLida } from './nfe-xml';

// NF-e RECEBIDAS (emitidas por terceiros contra a Gama) — gravação a partir
// de GET /v1/nfe/recebidas do eGestor. Ver FiscalNfeRecebida em
// prisma/schema.prisma e docs/console-fiscal.md, decisão 2.3.

export const ORIGEM_NFE_RECEBIDA = 'egestor:/v1/nfe/recebidas';

// Linha de GET /v1/nfe/recebidas. Não traz número/série — saem da chave.
export interface NfeRecebidaLista {
  codigo: number;
  tipo?: string | null;
  nsu?: string | number | null;
  chave?: string | null;
  cnpjEmit?: string | null;
  cnpjDest?: string | null;
  nomeEmit?: string | null;
  valorTotal?: string | number | null;
  ambiente?: number | null;
  situacao?: number | null;
  manifesto?: string | null;
  dtEmissao?: string | null;
  // O eGestor devolve um pedaço do XML quando tem o arquivo completo e
  // vazio quando só tem o resumo (nota sem manifestação de ciência).
  temXML?: unknown;
  temCompra?: string | number | boolean | null;
}

// O que já está gravado de cada nota — decide se precisa baixar o XML de
// novo ou só atualizar o resumo.
export interface NfeRecebidaGravada {
  chave: string;
  codEgestor: number | null;
  situacaoEgestor: number | null;
  manifesto: string | null;
  lancadaCompra: boolean;
  temXml: boolean;
}

export type AcaoNfeRecebida = 'baixar_xml' | 'atualizar_resumo' | 'nada';

export function temXmlNoEgestor(nota: NfeRecebidaLista): boolean {
  return typeof nota.temXML === 'string' ? nota.temXML.trim() !== '' : Boolean(nota.temXML);
}

export function lancadaComoCompra(nota: NfeRecebidaLista): boolean {
  return nota.temCompra === true || String(nota.temCompra ?? '') === '1';
}

export function acaoNfeRecebida(
  nota: NfeRecebidaLista,
  gravada: NfeRecebidaGravada | undefined,
): AcaoNfeRecebida {
  const mudouSituacao = !gravada || gravada.situacaoEgestor !== (nota.situacao ?? null);
  if (temXmlNoEgestor(nota) && (!gravada || !gravada.temXml || mudouSituacao)) {
    return 'baixar_xml';
  }
  if (
    !gravada ||
    mudouSituacao ||
    gravada.codEgestor !== nota.codigo ||
    (gravada.manifesto ?? null) !== (texto(nota.manifesto) ?? null) ||
    gravada.lancadaCompra !== lancadaComoCompra(nota)
  ) {
    return 'atualizar_resumo';
  }
  return 'nada';
}

// cSitNFe da SEFAZ: 1 autorizada, 2 denegada, 3 cancelada.
export function situacaoNfeRecebida(codigo: number | null | undefined): string {
  if (codigo === 1) return 'autorizada';
  if (codigo === 2) return 'denegada';
  if (codigo === 3) return 'cancelada';
  return 'desconhecida';
}

// Chave de acesso: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) …
export function partesDaChave(chave: string): { modelo: number; serie: number; numero: number } | null {
  if (!/^\d{44}$/.test(chave)) return null;
  return {
    modelo: Number(chave.slice(20, 22)),
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34)),
  };
}

export async function gravarNfeRecebida(
  tx: TenantTx,
  args: {
    workspaceId: string;
    estabelecimento: Estabelecimento;
    nota: NfeRecebidaLista & { chave: string };
    // Nota já gravada COM XML e que agora só muda o resumo: não mexe nos
    // totais nem nos itens que vieram do arquivo.
    preservarArquivo: boolean;
    xml: string | null;
    lida: NfeXmlLida | null;
    daLista: { data: string | null; instante: Date | null };
    decimal: (v: string | number | null | undefined) => string | null;
  },
): Promise<void> {
  const { workspaceId, estabelecimento, nota, preservarArquivo, xml, lida, daLista, decimal } = args;

  const resumo = {
    origem: ORIGEM_NFE_RECEBIDA,
    codEgestor: nota.codigo,
    situacao: situacaoNfeRecebida(nota.situacao),
    situacaoEgestor: nota.situacao ?? null,
    manifesto: texto(nota.manifesto),
    lancadaCompra: lancadaComoCompra(nota),
    nsu: texto(nota.nsu),
    sincronizadoEm: new Date(),
  };

  let dados: Record<string, unknown>;
  if (lida) {
    const c = lida.cabecalho;
    dados = {
      ...resumo,
      numero: c.numero,
      serie: c.serie,
      modelo: c.modelo,
      dhEmissao: c.dhEmissao ?? daLista.instante,
      dataEmissao: comoData(c.dataEmissao ?? daLista.data),
      sentido: c.sentido,
      naturezaOperacao: c.naturezaOperacao,
      finalidade: c.finalidade,
      emitCpfCnpj: c.emitCpfCnpj ?? texto(nota.cnpjEmit),
      emitNome: c.emitNome ?? texto(nota.nomeEmit),
      emitUf: c.emitUf,
      destCpfCnpj: c.destCpfCnpj ?? texto(nota.cnpjDest),
      vBc: c.vBc,
      vIcms: c.vIcms,
      vIcmsDeson: c.vIcmsDeson,
      vFcp: c.vFcp,
      vBcSt: c.vBcSt,
      vSt: c.vSt,
      vFcpSt: c.vFcpSt,
      vFcpStRet: c.vFcpStRet,
      vIcmsUfDest: c.vIcmsUfDest,
      vFcpUfDest: c.vFcpUfDest,
      vIcmsUfRemet: c.vIcmsUfRemet,
      vProd: c.vProd,
      vFrete: c.vFrete,
      vSeg: c.vSeg,
      vDesc: c.vDesc,
      vIi: c.vIi,
      vIpi: c.vIpi,
      vIpiDevol: c.vIpiDevol,
      vPis: c.vPis,
      vCofins: c.vCofins,
      vOutro: c.vOutro,
      vNf: c.vNf ?? decimal(nota.valorTotal),
      vTotTrib: c.vTotTrib,
      vBcIbsCbs: c.vBcIbsCbs,
      vIbs: c.vIbs,
      vCbs: c.vCbs,
      refChaves: c.refChaves,
      infCpl: c.infCpl,
      xml,
    };
  } else if (preservarArquivo) {
    dados = resumo;
  } else {
    const partes = partesDaChave(nota.chave);
    dados = {
      ...resumo,
      numero: partes?.numero ?? null,
      serie: partes?.serie ?? null,
      modelo: partes?.modelo ?? null,
      dhEmissao: daLista.instante,
      dataEmissao: comoData(daLista.data),
      emitCpfCnpj: texto(nota.cnpjEmit),
      emitNome: texto(nota.nomeEmit),
      destCpfCnpj: texto(nota.cnpjDest),
      vNf: decimal(nota.valorTotal),
    };
  }

  const salva = await tx.fiscalNfeRecebida.upsert({
    where: {
      workspaceId_estabelecimento_chave: { workspaceId, estabelecimento, chave: nota.chave },
    },
    create: { workspaceId, estabelecimento, chave: nota.chave, ...dados, situacao: resumo.situacao },
    update: dados,
    select: { id: true },
  });

  if (lida) {
    await tx.fiscalNfeRecebidaItem.deleteMany({ where: { nfeId: salva.id } });
    if (lida.itens.length > 0) {
      await tx.fiscalNfeRecebidaItem.createMany({
        data: lida.itens.map((item) => ({ workspaceId, nfeId: salva.id, ...item })),
      });
    }
  }
}

// O eGestor manda alguns campos ora como texto, ora como número (o NSU,
// por exemplo, vem numérico).
function texto(valor: string | number | null | undefined): string | null {
  const t = valor === null || valor === undefined ? '' : String(valor).trim();
  return t ? t : null;
}

function comoData(data: string | null): Date | null {
  return data ? new Date(`${data}T00:00:00.000Z`) : null;
}
