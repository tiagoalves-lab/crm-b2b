// Leitura do XML da NF-e (nfeProc, layout 4.00 com o grupo IBS/CBS da
// reforma) pro console fiscal — docs/console-fiscal.md.
//
// Extração por tag, sem biblioteca de XML: o layout da SEFAZ é fixo, sem
// CDATA, sem prefixo de namespace dentro de <NFe> e sem tag que contenha
// outra de mesmo nome — então "primeiro <tag>…</tag> dentro do grupo
// certo" é exato. O cuidado que importa é ESCOPO: <vBC> aparece no ICMS,
// no IPI, no PIS, no COFINS e no IBS/CBS do mesmo item, por isso todo
// campo de imposto é lido de dentro do bloco do seu grupo, nunca do XML
// inteiro. A regex exige espaço ou ">" depois do nome, então <ICMS> não
// casa com <ICMSTot> nem <PIS> com <PISST>.
//
// Valores monetários saem como string ("1234.56", como estão no XML) e vão
// direto pra coluna Decimal — nunca passam por float.

export interface NfeXmlCabecalho {
  chave: string | null;
  numero: number | null;
  serie: number | null;
  modelo: number | null;
  dhEmissao: Date | null;
  // Data LOCAL da nota (AAAA-MM-DD), como está no XML — é dela que saem
  // mês e trimestre de apuração (decisão 3.4).
  dataEmissao: string | null;
  sentido: 'entrada' | 'saida' | null;
  naturezaOperacao: string | null;
  finalidade: number | null;
  // Emitente — nas notas recebidas é o fornecedor.
  emitCpfCnpj: string | null;
  emitNome: string | null;
  emitUf: string | null;
  destCpfCnpj: string | null;
  destNome: string | null;
  destUf: string | null;
  destIndIe: number | null;
  vBc: string | null;
  vIcms: string | null;
  vIcmsDeson: string | null;
  vFcp: string | null;
  vBcSt: string | null;
  vSt: string | null;
  vFcpSt: string | null;
  vFcpStRet: string | null;
  vIcmsUfDest: string | null;
  vFcpUfDest: string | null;
  vIcmsUfRemet: string | null;
  vProd: string | null;
  vFrete: string | null;
  vSeg: string | null;
  vDesc: string | null;
  vIi: string | null;
  vIpi: string | null;
  vIpiDevol: string | null;
  vPis: string | null;
  vCofins: string | null;
  vOutro: string | null;
  vNf: string | null;
  vTotTrib: string | null;
  vBcIbsCbs: string | null;
  vIbs: string | null;
  vCbs: string | null;
  refChaves: string[];
  infCpl: string | null;
}

export interface NfeXmlItem {
  nItem: number;
  cProd: string | null;
  xProd: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  uCom: string | null;
  qCom: string | null;
  vUnCom: string | null;
  vProd: string | null;
  vFrete: string | null;
  vSeg: string | null;
  vDesc: string | null;
  vOutro: string | null;
  origIcms: string | null;
  cstIcms: string | null;
  vBcIcms: string | null;
  pRedBc: string | null;
  pIcms: string | null;
  vIcms: string | null;
  vIcmsDeson: string | null;
  vFcp: string | null;
  vBcSt: string | null;
  pMvaSt: string | null;
  pIcmsSt: string | null;
  vIcmsSt: string | null;
  vIcmsUfDest: string | null;
  vFcpUfDest: string | null;
  vIcmsUfRemet: string | null;
  cstIpi: string | null;
  cEnqIpi: string | null;
  vBcIpi: string | null;
  pIpi: string | null;
  vIpi: string | null;
  vIi: string | null;
  cstPis: string | null;
  vBcPis: string | null;
  pPis: string | null;
  vPis: string | null;
  cstCofins: string | null;
  vBcCofins: string | null;
  pCofins: string | null;
  vCofins: string | null;
  cstIbsCbs: string | null;
  cClassTrib: string | null;
  vBcIbsCbs: string | null;
  pIbsUf: string | null;
  vIbsUf: string | null;
  pIbsMun: string | null;
  vIbsMun: string | null;
  vIbs: string | null;
  pCbs: string | null;
  vCbs: string | null;
  vTotTrib: string | null;
}

export interface NfeXmlLida {
  cabecalho: NfeXmlCabecalho;
  itens: NfeXmlItem[];
}

export function lerNfeXml(xml: string): NfeXmlLida {
  const infNFe = bloco(xml, 'infNFe');
  if (!infNFe) {
    throw new Error('XML sem o grupo <infNFe> — não é uma NF-e.');
  }

  const ide = bloco(infNFe, 'ide');
  const emit = bloco(infNFe, 'emit');
  const dest = bloco(infNFe, 'dest');
  const icmsTot = bloco(infNFe, 'ICMSTot');
  const ibsCbsTot = bloco(infNFe, 'IBSCBSTot');

  const dhEmi = texto(ide, 'dhEmi') ?? texto(ide, 'dEmi');
  const tpNF = texto(ide, 'tpNF');

  const cabecalho: NfeXmlCabecalho = {
    chave: lerChave(xml),
    numero: inteiro(texto(ide, 'nNF')),
    serie: inteiro(texto(ide, 'serie')),
    modelo: inteiro(texto(ide, 'mod')),
    dhEmissao: dhEmi ? dataValida(dhEmi) : null,
    dataEmissao: dhEmi && /^\d{4}-\d{2}-\d{2}/.test(dhEmi) ? dhEmi.slice(0, 10) : null,
    sentido: tpNF === '0' ? 'entrada' : tpNF === '1' ? 'saida' : null,
    naturezaOperacao: texto(ide, 'natOp'),
    finalidade: inteiro(texto(ide, 'finNFe')),
    emitCpfCnpj: texto(emit, 'CNPJ') ?? texto(emit, 'CPF'),
    emitNome: texto(emit, 'xNome'),
    emitUf: texto(bloco(emit, 'enderEmit'), 'UF'),
    destCpfCnpj: texto(dest, 'CNPJ') ?? texto(dest, 'CPF') ?? texto(dest, 'idEstrangeiro'),
    destNome: texto(dest, 'xNome'),
    destUf: texto(bloco(dest, 'enderDest'), 'UF'),
    destIndIe: inteiro(texto(dest, 'indIEDest')),
    vBc: texto(icmsTot, 'vBC'),
    vIcms: texto(icmsTot, 'vICMS'),
    vIcmsDeson: texto(icmsTot, 'vICMSDeson'),
    vFcp: texto(icmsTot, 'vFCP'),
    vBcSt: texto(icmsTot, 'vBCST'),
    vSt: texto(icmsTot, 'vST'),
    vFcpSt: texto(icmsTot, 'vFCPST'),
    vFcpStRet: texto(icmsTot, 'vFCPSTRet'),
    vIcmsUfDest: texto(icmsTot, 'vICMSUFDest'),
    vFcpUfDest: texto(icmsTot, 'vFCPUFDest'),
    vIcmsUfRemet: texto(icmsTot, 'vICMSUFRemet'),
    vProd: texto(icmsTot, 'vProd'),
    vFrete: texto(icmsTot, 'vFrete'),
    vSeg: texto(icmsTot, 'vSeg'),
    vDesc: texto(icmsTot, 'vDesc'),
    vIi: texto(icmsTot, 'vII'),
    vIpi: texto(icmsTot, 'vIPI'),
    vIpiDevol: texto(icmsTot, 'vIPIDevol'),
    vPis: texto(icmsTot, 'vPIS'),
    vCofins: texto(icmsTot, 'vCOFINS'),
    vOutro: texto(icmsTot, 'vOutro'),
    vNf: texto(icmsTot, 'vNF'),
    vTotTrib: texto(icmsTot, 'vTotTrib'),
    vBcIbsCbs: texto(ibsCbsTot, 'vBCIBSCBS'),
    vIbs: texto(bloco(ibsCbsTot, 'gIBS'), 'vIBS'),
    vCbs: texto(bloco(ibsCbsTot, 'gCBS'), 'vCBS'),
    refChaves: blocos(ide ?? '', 'refNFe').map((r) => decodificar(r.conteudo).trim()),
    infCpl: texto(bloco(infNFe, 'infAdic'), 'infCpl'),
  };

  const itens = blocos(infNFe, 'det').map((det, i) => lerItem(det, i + 1));

  return { cabecalho, itens };
}

function lerItem(det: { atributos: string; conteudo: string }, posicao: number): NfeXmlItem {
  const prod = bloco(det.conteudo, 'prod');
  const imposto = bloco(det.conteudo, 'imposto');
  const icms = bloco(imposto, 'ICMS');
  const icmsUfDest = bloco(imposto, 'ICMSUFDest');
  const ipi = bloco(imposto, 'IPI');
  const ii = bloco(imposto, 'II');
  const pis = bloco(imposto, 'PIS');
  const cofins = bloco(imposto, 'COFINS');
  const ibsCbs = bloco(imposto, 'IBSCBS');
  const gIbsCbs = bloco(ibsCbs, 'gIBSCBS');
  const gIbsUf = bloco(gIbsCbs, 'gIBSUF');
  const gIbsMun = bloco(gIbsCbs, 'gIBSMun');
  const gCbs = bloco(gIbsCbs, 'gCBS');

  const nItemAttr = /nItem="(\d+)"/.exec(det.atributos);

  return {
    nItem: nItemAttr ? Number(nItemAttr[1]) : posicao,
    cProd: texto(prod, 'cProd'),
    xProd: texto(prod, 'xProd'),
    ncm: texto(prod, 'NCM'),
    cest: texto(prod, 'CEST'),
    cfop: texto(prod, 'CFOP'),
    uCom: texto(prod, 'uCom'),
    qCom: texto(prod, 'qCom'),
    vUnCom: texto(prod, 'vUnCom'),
    vProd: texto(prod, 'vProd'),
    vFrete: texto(prod, 'vFrete'),
    vSeg: texto(prod, 'vSeg'),
    vDesc: texto(prod, 'vDesc'),
    vOutro: texto(prod, 'vOutro'),
    origIcms: texto(icms, 'orig'),
    cstIcms: texto(icms, 'CST') ?? texto(icms, 'CSOSN'),
    vBcIcms: texto(icms, 'vBC'),
    pRedBc: texto(icms, 'pRedBC'),
    pIcms: texto(icms, 'pICMS'),
    vIcms: texto(icms, 'vICMS'),
    vIcmsDeson: texto(icms, 'vICMSDeson'),
    vFcp: texto(icms, 'vFCP'),
    vBcSt: texto(icms, 'vBCST'),
    pMvaSt: texto(icms, 'pMVAST'),
    pIcmsSt: texto(icms, 'pICMSST'),
    vIcmsSt: texto(icms, 'vICMSST'),
    vIcmsUfDest: texto(icmsUfDest, 'vICMSUFDest'),
    vFcpUfDest: texto(icmsUfDest, 'vFCPUFDest'),
    vIcmsUfRemet: texto(icmsUfDest, 'vICMSUFRemet'),
    cstIpi: texto(ipi, 'CST'),
    cEnqIpi: texto(ipi, 'cEnq'),
    vBcIpi: texto(ipi, 'vBC'),
    pIpi: texto(ipi, 'pIPI'),
    vIpi: texto(ipi, 'vIPI'),
    vIi: texto(ii, 'vII'),
    cstPis: texto(pis, 'CST'),
    vBcPis: texto(pis, 'vBC'),
    pPis: texto(pis, 'pPIS'),
    vPis: texto(pis, 'vPIS'),
    cstCofins: texto(cofins, 'CST'),
    vBcCofins: texto(cofins, 'vBC'),
    pCofins: texto(cofins, 'pCOFINS'),
    vCofins: texto(cofins, 'vCOFINS'),
    cstIbsCbs: texto(ibsCbs, 'CST'),
    cClassTrib: texto(ibsCbs, 'cClassTrib'),
    vBcIbsCbs: texto(gIbsCbs, 'vBC'),
    pIbsUf: texto(gIbsUf, 'pIBSUF'),
    vIbsUf: texto(gIbsUf, 'vIBSUF'),
    pIbsMun: texto(gIbsMun, 'pIBSMun'),
    vIbsMun: texto(gIbsMun, 'vIBSMun'),
    vIbs: texto(gIbsCbs, 'vIBS'),
    pCbs: texto(gCbs, 'pCBS'),
    vCbs: texto(gCbs, 'vCBS'),
    vTotTrib: texto(imposto, 'vTotTrib'),
  };
}

// Chave de acesso: atributo Id do <infNFe> ("NFe" + 44 dígitos); se o XML
// vier sem ele, o <chNFe> do protocolo de autorização.
function lerChave(xml: string): string | null {
  const id = /<infNFe\b[^>]*\bId="NFe(\d{44})"/.exec(xml);
  if (id) return id[1];
  const ch = texto(bloco(xml, 'protNFe'), 'chNFe');
  return ch && /^\d{44}$/.test(ch) ? ch : null;
}

function regexTag(tag: string, flags = ''): RegExp {
  return new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, flags);
}

function bloco(xml: string | null, tag: string): string | null {
  if (!xml) return null;
  const m = regexTag(tag).exec(xml);
  return m ? m[2] : null;
}

function blocos(xml: string, tag: string): { atributos: string; conteudo: string }[] {
  return [...xml.matchAll(regexTag(tag, 'g'))].map((m) => ({
    atributos: m[1] ?? '',
    conteudo: m[2],
  }));
}

function texto(xml: string | null, tag: string): string | null {
  const conteudo = bloco(xml, tag);
  if (conteudo === null) return null;
  const valor = decodificar(conteudo).trim();
  return valor === '' ? null : valor;
}

function decodificar(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function inteiro(v: string | null): number | null {
  if (v === null || !/^-?\d+$/.test(v)) return null;
  return Number(v);
}

function dataValida(v: string): Date | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
