import { lerNfeXml } from './nfe-xml';

// NF-e fictícia (dados inventados) com as armadilhas reais do layout:
// <vBC> com valor diferente em cada grupo de imposto do mesmo item, <ICMS>
// ao lado de <ICMSTot>/<ICMSUFDest>, <PIS> ao lado de <PISST>, um item no
// Simples (CSOSN) com IPI não tributado, nota referenciada e entidade XML
// no texto.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe Id="NFe35261000000000000000550010000012341000012345" versao="4.00">
<ide><cUF>35</cUF><natOp>Venda de mercadoria &amp; remessa</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF>
<dhEmi>2026-09-30T22:15:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe>
<NFref><refNFe>35260900000000000000550010000011111000011111</refNFe></NFref>
<NFref><refNFe>35260900000000000000550010000022222000022222</refNFe></NFref></ide>
<emit><CNPJ>00000000000000</CNPJ><xNome>Emitente Ficticio</xNome><enderEmit><UF>SP</UF></enderEmit></emit>
<dest><CNPJ>11111111000111</CNPJ><xNome>Cliente Ficticio Ltda</xNome><enderDest><xLgr>Rua X</xLgr><UF>MG</UF></enderDest><indIEDest>9</indIEDest></dest>
<det nItem="1"><prod><cProd>MAQ-01</cProd><xProd>Maquina A</xProd><NCM>84779000</NCM><CFOP>6108</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>1000.0000000000</vUnCom><vProd>1000.00</vProd><vDesc>10.00</vDesc></prod>
<imposto><vTotTrib>300.00</vTotTrib>
<ICMS><ICMS00><orig>1</orig><CST>00</CST><modBC>3</modBC><vBC>990.00</vBC><pICMS>4.0000</pICMS><vICMS>39.60</vICMS></ICMS00></ICMS>
<ICMSUFDest><vBCUFDest>990.00</vBCUFDest><vFCPUFDest>0.00</vFCPUFDest><vICMSUFDest>99.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest>
<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>991.00</vBC><pIPI>5.0000</pIPI><vIPI>49.55</vIPI></IPITrib></IPI>
<II><vBC>0.00</vBC><vII>0.00</vII></II>
<PIS><PISAliq><CST>01</CST><vBC>992.00</vBC><pPIS>0.6500</pPIS><vPIS>6.45</vPIS></PISAliq></PIS>
<PISST><vBC>1.00</vBC><pPIS>9.0000</pPIS><vPIS>0.09</vPIS></PISST>
<COFINS><COFINSAliq><CST>01</CST><vBC>993.00</vBC><pCOFINS>3.0000</pCOFINS><vCOFINS>29.79</vCOFINS></COFINSAliq></COFINS>
<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>994.00</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.99</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.99</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>8.95</vCBS></gCBS></gIBSCBS></IBSCBS>
</imposto></det>
<det nItem="2"><prod><cProd>DEMO-01</cProd><xProd>Maquina demonstracao</xProd><NCM>84779000</NCM><CFOP>6912</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>500.0000000000</vUnCom><vProd>1000.00</vProd></prod>
<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
<IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>
<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>
<total><ICMSTot><vBC>990.00</vBC><vICMS>39.60</vICMS><vICMSDeson>0.00</vICMSDeson><vFCPUFDest>0.00</vFCPUFDest><vICMSUFDest>99.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>2000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>10.00</vDesc><vII>0.00</vII><vIPI>49.55</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>6.45</vPIS><vCOFINS>29.79</vCOFINS><vOutro>0.00</vOutro><vNF>2039.55</vNF><vTotTrib>300.00</vTotTrib></ICMSTot>
<IBSCBSTot><vBCIBSCBS>994.00</vBCIBSCBS><gIBS><gIBSUF><vIBSUF>0.99</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.99</vIBS></gIBS><gCBS><vCBS>8.95</vCBS></gCBS></IBSCBSTot></total>
<infAdic><infCpl>Retorno previsto em 60 dias &lt;demo&gt;</infCpl></infAdic>
</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>35261000000000000000550010000012341000012345</chNFe></infProt></protNFe></nfeProc>`;

describe('lerNfeXml', () => {
  const { cabecalho, itens } = lerNfeXml(XML);

  it('lê o cabeçalho, com a data local da nota separada do instante', () => {
    expect(cabecalho).toMatchObject({
      chave: '35261000000000000000550010000012341000012345',
      numero: 1234,
      serie: 1,
      modelo: 55,
      dataEmissao: '2026-09-30',
      sentido: 'saida',
      naturezaOperacao: 'Venda de mercadoria & remessa',
      finalidade: 1,
      emitCpfCnpj: '00000000000000',
      emitNome: 'Emitente Ficticio',
      emitUf: 'SP',
      destCpfCnpj: '11111111000111',
      destNome: 'Cliente Ficticio Ltda',
      destUf: 'MG',
      destIndIe: 9,
      infCpl: 'Retorno previsto em 60 dias <demo>',
    });
    // 22h15 de Brasília do dia 30 já é dia 1º em UTC — o mês de apuração
    // tem que sair de dataEmissao, não deste instante.
    expect(cabecalho.dhEmissao?.toISOString()).toBe('2026-10-01T01:15:00.000Z');
  });

  it('lê os totais do <ICMSTot> e do <IBSCBSTot>, sem confundir com os do item', () => {
    expect(cabecalho).toMatchObject({
      vBc: '990.00',
      vIcms: '39.60',
      vIcmsUfDest: '99.00',
      vProd: '2000.00',
      vDesc: '10.00',
      vIpi: '49.55',
      vPis: '6.45',
      vCofins: '29.79',
      vNf: '2039.55',
      vTotTrib: '300.00',
      vBcIbsCbs: '994.00',
      vIbs: '0.99',
      vCbs: '8.95',
    });
  });

  it('guarda todas as notas referenciadas', () => {
    expect(cabecalho.refChaves).toEqual([
      '35260900000000000000550010000011111000011111',
      '35260900000000000000550010000022222000022222',
    ]);
  });

  it('lê cada imposto do item dentro do próprio grupo (o vBC é diferente em cada um)', () => {
    expect(itens).toHaveLength(2);
    expect(itens[0]).toMatchObject({
      nItem: 1,
      cProd: 'MAQ-01',
      ncm: '84779000',
      cfop: '6108',
      qCom: '1.0000',
      vProd: '1000.00',
      vDesc: '10.00',
      origIcms: '1',
      cstIcms: '00',
      vBcIcms: '990.00',
      pIcms: '4.0000',
      vIcms: '39.60',
      vIcmsUfDest: '99.00',
      cstIpi: '50',
      cEnqIpi: '999',
      vBcIpi: '991.00',
      pIpi: '5.0000',
      vIpi: '49.55',
      vIi: '0.00',
      cstPis: '01',
      vBcPis: '992.00',
      pPis: '0.6500',
      vPis: '6.45',
      cstCofins: '01',
      vBcCofins: '993.00',
      pCofins: '3.0000',
      vCofins: '29.79',
      cstIbsCbs: '000',
      cClassTrib: '000001',
      vBcIbsCbs: '994.00',
      pIbsUf: '0.1000',
      vIbsUf: '0.99',
      vIbs: '0.99',
      pCbs: '0.9000',
      vCbs: '8.95',
      vTotTrib: '300.00',
    });
  });

  it('lê item sem imposto destacado (CSOSN, IPI e PIS/COFINS não tributados)', () => {
    expect(itens[1]).toMatchObject({
      nItem: 2,
      cfop: '6912',
      cstIcms: '102',
      vIcms: null,
      cstIpi: '53',
      vIpi: null,
      cstPis: '07',
      vPis: null,
      cstCofins: '07',
      cstIbsCbs: null,
      vTotTrib: null,
    });
  });

  it('recusa arquivo que não é NF-e', () => {
    expect(() => lerNfeXml('<html><body>erro</body></html>')).toThrow(/infNFe/);
  });
});
