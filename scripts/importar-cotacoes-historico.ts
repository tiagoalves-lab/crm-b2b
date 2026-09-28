// Import do histórico de cotações (planilha "Cotações", jul–set/2025) como
// oportunidades do Pipeline — fase 1 do plano combinado com o usuário em
// 2026-09-18.
//
// Regras fechadas com ele:
// - Valor da oportunidade = coluna "Total Custos" da planilha.
// - Item = código do produto + modelo, em texto livre (a ligação com o
//   cadastro de produtos do app de orçamentos é a fase 2, com plano de
//   migração próprio — não tentar adivinhar produto aqui).
// - Cliente casado por CNPJ (da planilha de contatos que ele anexou), não
//   por razão social: no CRM os nomes estão abreviados/acentuados de forma
//   diferente e o nome não bate (ex. "ORTOBRAS IND E COM" × "ORTOBRAS
//   INDUSTRIA E COMERCIO"). Todos os 56 clientes da planilha já existem
//   no CRM por CNPJ — o script NÃO cria empresa; se algum não for
//   encontrado, ele avisa e não grava nada daquela linha.
// - Situação: todas entram PERDIDAS com o motivo "Sem resultado registrado
//   (histórico)". As cotações são de jul–set/2025 e a máquina leva 3 a 4
//   meses entre aceite e nota; o que não foi faturado em mais de um ano,
//   na prática, não fechou. As exceções confirmadas entram ganhas (hoje
//   só a cotação 14, ORTOBRAS, que casou com duas notas de junho/2026 —
//   R$ 159.667 na matriz + R$ 319.333 na filial).
// - Sem registro no feed de atividades: é carga histórica, não trabalho de
//   hoje; o Painel não deve encher de "oportunidade criada" de 2025.
//
// Roda pelo Railway (ambiente do backend):
//
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/importar-cotacoes-historico.ts
//   node_modules\.bin\railway run node_modules\.bin\ts-node scripts/importar-cotacoes-historico.ts --apply
//
// Sem --apply é SIMULAÇÃO. Idempotente: reconhece cotação já importada
// pelo número no começo da descrição e não duplica.
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import { SupabaseUserService } from '../src/memberships/supabase-user.service';

const WORKSPACE_SLUG = 'gama';
const SYSTEM_ACTOR_USER_ID = '00000000-0000-4000-8000-000000000000';
const MOTIVO_HISTORICO = 'Sem resultado registrado (histórico)';
// Prazo médio entre aceite e entrega/nota, informado pelo usuário: 3 a 4
// meses (produção na China + nacionalização + transporte + instalação).
// Serve de previsão de fechamento e de data de encerramento das perdidas.
const DIAS_CICLO = 120;

// CNPJ por razão social, da planilha de contatos anexada pelo usuário.
const CNPJ: Record<string, string> = {
  'D R SUL': '28238695000163',
  MAXIMAQ: '01690362000114',
  JB: '44233425000116',
  LIONS: '30286472000113',
  EXPOENTE: '85498509000169',
  MANTECH: '28632337000130',
  ENGTECH: '11354470000170',
  HARAMAQ: '05113116000150',
  ORTOBRAS: '31228836000171',
  'MC INOX': '52629297000152',
  GELMAKI: '24162637000142',
  SUPORT: '04991967000133',
  'AQUA SLIDES': '46186936000150',
  BRUSINOX: '00939873000164',
  KEHL: '36918943000145',
  DAX: '23704608000100',
  FIMACO: '14656257000100',
  'FERRAMENTARIA 3D': '24876818000130',
  PERFITUBO: '30972783000136',
  ANCORA: '03766908000107',
  'FACAS CASCAVEL': '91291583000102',
  JULIANO: '45780826000159',
  RHODOSS: '08641404000176',
  FARENZENA: '00506489000178',
  SPORTMANIA: '72425960000104',
  SCHIOPPA: '61174652000137',
  FAEMES: '86470937000146',
  SANTANA: '23982289000197',
  MCR: '12141251000175',
  'RIO BONITO': '00934662000139',
  AGRIMEC: '88093141000147',
  METALFRESA: '04214187000187',
  STAM: '30560205000192',
  'R M D': '07456648000116',
  NEWTEC: '94167350000190',
  RF: '11249845000131',
  ROSSO: '10578405000165',
  ELETROPLASMA: '38809737000122',
  NG: '20875695000162',
  PRESOTTO: '05810754000120',
  HIDROENERGIA: '03975548000145',
  RESFRIADORES: '34999760000176',
  PASCHOAL: '60402401000108',
  ARLINDO: '92065176000140',
  FLG: '48087255000160',
  ANTONOW: '88803853000102',
  ADRIANO: '16869644000150',
  BAKY: '26554716000124',
  FERKE: '34996428000158',
  MAXIMA: '22591500000188',
  'TORNEARIA EF': '21681334000148',
  THOR: '90312885000157',
  BERLINERLUFT: '03593705000158',
  METALSUL: '46693071000118',
  FONSECA: '11417768000181',
  MZ: '03749542000150',
};

type Cotacao = {
  num: number;
  cli: string;
  dt: string;
  cod: string;
  modelo: string;
  valor: number;
  rep: string;
};

// num, cliente (chave do CNPJ acima), data, código, modelo, Total Custos, representante
const COTACOES: Cotacao[] = [
  { num: 4, cli: 'D R SUL', dt: '2025-07-15', cod: 'GM6025D', modelo: '12000W & TIANCHEN', valor: 974250.62, rep: 'Lucas Makinodan' },
  { num: 5, cli: 'MAXIMAQ', dt: '2025-07-16', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 315778.19, rep: 'Lauro' },
  { num: 6, cli: 'JB', dt: '2025-07-16', cod: 'GM3015D', modelo: '3000W & TIANCHEN', valor: 444075.11, rep: 'Lauro' },
  { num: 7, cli: 'MAXIMAQ', dt: '2025-07-16', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 309000, rep: 'Lauro' },
  { num: 8, cli: 'LIONS', dt: '2025-07-16', cod: '200T 3200', modelo: 'DA58TX 4+1', valor: 711334.51, rep: 'Lauro' },
  { num: 9, cli: 'EXPOENTE', dt: '2025-07-16', cod: 'GM3015TD', modelo: '6000W', valor: 667110.41, rep: 'Lauro' },
  { num: 10, cli: 'MANTECH', dt: '2025-07-17', cod: 'GM6025SP', modelo: '6000W', valor: 538147.93, rep: 'Maiquel' },
  { num: 11, cli: 'ENGTECH', dt: '2025-07-17', cod: 'GM3015TD', modelo: '3000W', valor: 594399.3, rep: 'Maiquel' },
  { num: 12, cli: 'HARAMAQ', dt: '2025-07-18', cod: 'GM6025D', modelo: '12000W & TIANCHEN', valor: 920787.09, rep: 'Maiquel' },
  { num: 13, cli: 'HARAMAQ', dt: '2025-07-18', cod: 'GM6025D', modelo: '12000W & TIANCHEN', valor: 1181529.35, rep: 'Maiquel' },
  { num: 14, cli: 'ORTOBRAS', dt: '2025-07-18', cod: 'GM4020D', modelo: '12000W', valor: 961829.86, rep: 'Maiquel' },
  { num: 15, cli: 'MC INOX', dt: '2025-07-23', cod: '135T 3200', modelo: 'DA58TX 4+1', valor: 538104.46, rep: 'Lauro' },
  { num: 16, cli: 'MC INOX', dt: '2025-07-23', cod: '135T 3200', modelo: 'DA58TX 4+1', valor: 537583.04, rep: 'Lauro' },
  { num: 17, cli: 'GELMAKI', dt: '2025-07-23', cod: 'GM6025S', modelo: '3000W', valor: 488686.81, rep: 'Lauro' },
  { num: 18, cli: 'SUPORT', dt: '2025-07-23', cod: '400T 3200', modelo: 'DA58TX 4+1', valor: 845957.05, rep: 'Lauro' },
  { num: 19, cli: 'AQUA SLIDES', dt: '2025-07-23', cod: 'GM3015ST', modelo: '3000W', valor: 415939.25, rep: 'Lauro' },
  { num: 20, cli: 'AQUA SLIDES', dt: '2025-07-23', cod: 'GM3015ST', modelo: '3000W', valor: 415939.25, rep: 'Lauro' },
  { num: 21, cli: 'AQUA SLIDES', dt: '2025-07-23', cod: 'GM3015TD', modelo: '3000W', valor: 600153.37, rep: 'Lauro' },
  { num: 22, cli: 'GELMAKI', dt: '2025-07-23', cod: 'GM6025S', modelo: '3000W', valor: 413276.81, rep: 'Lauro' },
  { num: 23, cli: 'AQUA SLIDES', dt: '2025-07-24', cod: 'GM3015TD', modelo: '3000W', valor: 477120, rep: 'Lauro' },
  { num: 24, cli: 'AQUA SLIDES', dt: '2025-07-24', cod: 'GM3015TD', modelo: '3000W', valor: 638784.97, rep: 'Lauro' },
  { num: 25, cli: 'BRUSINOX', dt: '2025-07-24', cod: 'GM350', modelo: '6000W', valor: 697055.38, rep: 'Lauro' },
  { num: 26, cli: 'KEHL', dt: '2025-07-24', cod: 'GM6025D', modelo: '12000W & TIANCHEN', valor: 956300.46, rep: 'Maiquel' },
  { num: 27, cli: 'DAX', dt: '2025-07-25', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 323213.96, rep: 'Edilson Gonçalves' },
  { num: 28, cli: 'DAX', dt: '2025-07-25', cod: 'GM230', modelo: '3000W', valor: 526723.96, rep: 'Edilson Gonçalves' },
  { num: 29, cli: 'SUPORT', dt: '2025-07-25', cod: '400T 3200', modelo: 'DA58TX 4+1', valor: 1050264.03, rep: 'Lauro' },
  { num: 30, cli: 'FIMACO', dt: '2025-07-25', cod: 'W12-20X3000', modelo: 'ESA 860W', valor: 791053.12, rep: 'Lauro' },
  { num: 31, cli: 'FERRAMENTARIA 3D', dt: '2025-07-28', cod: 'CAK6150V', modelo: '1000MM & SIEMENS', valor: 475858.02, rep: 'Lauro' },
  { num: 32, cli: 'SUPORT', dt: '2025-07-28', cod: '400T 3200', modelo: 'DA58TX 4+1', valor: 1009219.7, rep: 'Lauro' },
  { num: 33, cli: 'SUPORT', dt: '2025-07-28', cod: '400T 3200', modelo: 'DA58TX 4+1', valor: 947686.41, rep: 'Lauro' },
  { num: 34, cli: 'FERRAMENTARIA 3D', dt: '2025-07-28', cod: 'CAK6150V', modelo: '1000MM & SIEMENS', valor: 434743.7, rep: 'Lauro' },
  { num: 35, cli: 'FERRAMENTARIA 3D', dt: '2025-07-28', cod: 'CAK6150V', modelo: '1000MM & SIEMENS', valor: 456252.8, rep: 'Lauro' },
  { num: 36, cli: 'PERFITUBO', dt: '2025-07-28', cod: '6X6000 E21S', modelo: '', valor: 499721.5, rep: 'Lauro' },
  { num: 37, cli: 'PERFITUBO', dt: '2025-07-28', cod: '8X6000 E21S', modelo: '', valor: 538404.99, rep: 'Lauro' },
  { num: 38, cli: 'DAX', dt: '2025-07-28', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 319466.07, rep: 'Edilson Gonçalves' },
  { num: 39, cli: 'DAX', dt: '2025-07-29', cod: 'GM230', modelo: '3000W', valor: 526723.96, rep: 'Edilson Gonçalves' },
  { num: 41, cli: 'ANCORA', dt: '2025-07-30', cod: '8X3200 E21S', modelo: '', valor: 363440.12, rep: 'Lauro' },
  { num: 42, cli: 'ANCORA', dt: '2025-07-30', cod: '160T 3200', modelo: 'DA58TX 4+1', valor: 543285.51, rep: 'Lauro' },
  { num: 43, cli: 'FACAS CASCAVEL', dt: '2025-07-30', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 318181.15, rep: 'Maiquel' },
  { num: 44, cli: 'JULIANO', dt: '2025-07-31', cod: 'GM4020D', modelo: '6000W', valor: 560949.71, rep: 'Lauro' },
  { num: 45, cli: 'JULIANO', dt: '2025-07-31', cod: 'W12-25X3000', modelo: 'ESA 860W', valor: 825329.74, rep: 'Lauro' },
  { num: 46, cli: 'FACAS CASCAVEL', dt: '2025-07-30', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 302422.65, rep: 'Maiquel' },
  { num: 47, cli: 'RHODOSS', dt: '2025-07-31', cod: 'GM3015D', modelo: '3000W & TIANCHEN', valor: 398745.71, rep: 'Maiquel' },
  { num: 48, cli: 'RHODOSS', dt: '2025-07-31', cod: 'GM3015D', modelo: '6000W & TIANCHEN', valor: 492668.64, rep: 'Maiquel' },
  { num: 49, cli: 'DAX', dt: '2025-07-31', cod: 'GM3015TD', modelo: '3000W', valor: 567670.24, rep: 'Edilson Gonçalves' },
  { num: 51, cli: 'RHODOSS', dt: '2025-07-31', cod: 'GM6015D', modelo: '3000W', valor: 553354.82, rep: 'Maiquel' },
  { num: 52, cli: 'RHODOSS', dt: '2025-07-31', cod: 'GM6015D', modelo: '6000W', valor: 646049.11, rep: 'Maiquel' },
  { num: 53, cli: 'FARENZENA', dt: '2025-07-31', cod: 'GM3015TD', modelo: '3000W', valor: 619523.12, rep: 'Maiquel' },
  { num: 2125, cli: 'SPORTMANIA', dt: '2025-08-01', cod: 'GM230', modelo: '3000W', valor: 494415.27, rep: 'Lucas Makinodan' },
  { num: 2126, cli: 'SPORTMANIA', dt: '2025-08-01', cod: 'GM3015D', modelo: '6000W & TIANCHEN', valor: 494783.75, rep: 'Lucas Makinodan' },
  { num: 2128, cli: 'SCHIOPPA', dt: '2025-08-01', cod: 'GM3015D', modelo: '6000W & TIANCHEN', valor: 529128.23, rep: 'Rodrigo Vascotto' },
  { num: 2130, cli: 'SCHIOPPA', dt: '2025-08-01', cod: 'GM3015D', modelo: '3000W & TIANCHEN', valor: 430506.68, rep: 'Rodrigo Vascotto' },
  { num: 2131, cli: 'SCHIOPPA', dt: '2025-08-01', cod: '30T 1300', modelo: 'ET16', valor: 399571.21, rep: 'Rodrigo Vascotto' },
  { num: 2132, cli: 'FAEMES', dt: '2025-08-06', cod: 'GM3015D', modelo: '3000W & TIANCHEN', valor: 428187.11, rep: 'Darlã' },
  { num: 2133, cli: 'DAX', dt: '2025-08-06', cod: 'GM3015ST', modelo: '3000W', valor: 417095.87, rep: 'Edilson Gonçalves' },
  { num: 2134, cli: 'SANTANA', dt: '2025-08-07', cod: 'GM6025D', modelo: '40000W', valor: 1802827.9, rep: 'Darlã' },
  { num: 2135, cli: 'MCR', dt: '2025-08-07', cod: 'GM3015D', modelo: '20000W', valor: 1131237.14, rep: 'Darlã' },
  { num: 2136, cli: 'MCR', dt: '2025-08-07', cod: 'GM3015D', modelo: '12000W & TIANCHEN', valor: 840739.29, rep: 'Darlã' },
  { num: 2137, cli: 'RIO BONITO', dt: '2025-08-08', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 321273.35, rep: 'Edilson Gonçalves' },
  { num: 2139, cli: 'AGRIMEC', dt: '2025-08-11', cod: '40T 1300', modelo: 'ET18 6 EIXOS', valor: 435773.74, rep: 'Maiquel' },
  { num: 2140, cli: 'METALFRESA', dt: '2025-08-12', cod: 'GL2000', modelo: 'NACIONALIZADA', valor: 96536.89, rep: 'Lucas Makinodan' },
  { num: 2141, cli: 'STAM', dt: '2025-08-11', cod: 'GM120', modelo: '3000W', valor: 491324.55, rep: 'Maiquel' },
  { num: 2142, cli: 'R M D', dt: '2025-08-13', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 315318.24, rep: 'Edilson Gonçalves' },
  { num: 2143, cli: 'STAM', dt: '2025-08-13', cod: 'GM120', modelo: '3000W', valor: 641699.47, rep: 'Maiquel' },
  { num: 2145, cli: 'NEWTEC', dt: '2025-08-14', cod: '160T 4000', modelo: 'DA69S 6+1', valor: 614041.99, rep: 'Maiquel' },
  { num: 2146, cli: 'RF', dt: '2025-08-18', cod: 'GMC1614', modelo: '', valor: 982180.37, rep: 'Lauro' },
  { num: 2147, cli: 'ROSSO', dt: '2025-08-18', cod: '200T 4000', modelo: 'DA53T 4+1', valor: 569067.63, rep: 'Maiquel' },
  { num: 2149, cli: 'ELETROPLASMA', dt: '2025-08-18', cod: '135T 3200', modelo: 'DA66S 4+1', valor: 521810.5, rep: 'Levi Gomes' },
  { num: 2150, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: '135T 3200', modelo: 'E300P XY', valor: 325844.81, rep: 'Levi Gomes' },
  { num: 2152, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: '135T 3200', modelo: 'DA66S 4+1 TD', valor: 1019631.46, rep: 'Levi Gomes' },
  { num: 2153, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: '250T 3200', modelo: 'DA66S 3+1 TD', valor: 1163216.1, rep: 'Levi Gomes' },
  { num: 2154, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: 'GM6025SP', modelo: '20000W', valor: 1116996.43, rep: 'Levi Gomes' },
  { num: 2155, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: 'GM6025SP', modelo: '40000W', valor: 1510166.79, rep: 'Levi Gomes' },
  { num: 2157, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: '135T 3200', modelo: 'DA53T 4+1', valor: 480356.65, rep: 'Levi Gomes' },
  { num: 2158, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: 'GM6025SP', modelo: '20000W', valor: 1152855.15, rep: 'Levi Gomes' },
  { num: 2159, cli: 'ELETROPLASMA', dt: '2025-08-19', cod: 'GM6025SP', modelo: '40000W', valor: 1546025.5, rep: 'Levi Gomes' },
  { num: 2160, cli: 'NG', dt: '2025-08-20', cod: 'GM3015D', modelo: '3000W & TIANCHEN', valor: 409637.33, rep: 'Maiquel' },
  { num: 2161, cli: 'FARENZENA', dt: '2025-08-20', cod: 'GM3015TD', modelo: '6000W', valor: 689422.92, rep: 'Maiquel' },
  { num: 2162, cli: 'ANCORA', dt: '2025-08-20', cod: 'GM3015SP', modelo: '6000W', valor: 487834.76, rep: 'Lauro' },
  { num: 2163, cli: 'PRESOTTO', dt: '2025-08-20', cod: 'GM6025SP', modelo: '20000W', valor: 1130019.48, rep: 'Maiquel' },
  { num: 2164, cli: 'PRESOTTO', dt: '2025-08-20', cod: 'GL2000', modelo: 'NACIONALIZADA', valor: 91033.13, rep: 'Maiquel' },
  { num: 2165, cli: 'PRESOTTO', dt: '2025-08-20', cod: 'GM3015SP', modelo: '20000W', valor: 1069014.94, rep: 'Maiquel' },
  { num: 2166, cli: 'HIDROENERGIA', dt: '2025-08-20', cod: 'GM3015D', modelo: '6000W & TIANCHEN', valor: 477335.44, rep: 'Maiquel' },
  { num: 2167, cli: 'RESFRIADORES', dt: '2025-08-20', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 308098.1, rep: 'Maiquel' },
  { num: 2168, cli: 'NG', dt: '2025-08-20', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 308098.1, rep: 'Maiquel' },
  { num: 2169, cli: 'PASCHOAL', dt: '2025-08-21', cod: 'GM165', modelo: '3000W', valor: 512670.99, rep: 'Rodrigo Vascotto' },
  { num: 2170, cli: 'NEWTEC', dt: '2025-08-21', cod: '125T 3200', modelo: 'DA66S 6+1', valor: 523650.9, rep: 'Rafael Ferracini' },
  { num: 2171, cli: 'NEWTEC', dt: '2025-08-21', cod: '125T 4000', modelo: 'DA66S 6+1', valor: 535664.25, rep: 'Rafael Ferracini' },
  { num: 2172, cli: 'ARLINDO', dt: '2025-08-21', cod: 'HMC630', modelo: '', valor: 1345025.89, rep: 'Maiquel' },
  { num: 2173, cli: 'JULIANO', dt: '2025-08-26', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 327228.03, rep: 'Lauro' },
  { num: 2174, cli: 'JULIANO', dt: '2025-08-26', cod: 'GM3015D', modelo: '3000W & TIANCHEN', valor: 440633.92, rep: 'Lauro' },
  { num: 2175, cli: 'FLG', dt: '2025-08-22', cod: '160T 3200', modelo: 'DA53T 4+1', valor: 471044.67, rep: 'Gustavo Hainzenreder' },
  { num: 2176, cli: 'ANTONOW', dt: '2025-08-22', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 308098.1, rep: 'Gilmar Oliveira' },
  { num: 2177, cli: 'ADRIANO', dt: '2025-08-22', cod: 'GM165', modelo: '3000W', valor: 480448.1, rep: 'Maiquel' },
  { num: 2178, cli: 'JULIANO', dt: '2025-08-26', cod: 'CAK6150V', modelo: '1000MM & SIEMENS', valor: 439109.24, rep: 'Lauro' },
  { num: 2179, cli: 'JULIANO', dt: '2025-08-26', cod: 'CAK6160V', modelo: '1000MM & SIEMENS', valor: 392959.18, rep: 'Lauro' },
  { num: 2180, cli: 'JULIANO', dt: '2025-08-26', cod: 'W12-16X3000', modelo: 'ESA 860W', valor: 650391.94, rep: 'Lauro' },
  { num: 2181, cli: 'BAKY', dt: '2025-08-27', cod: 'GM3015SP', modelo: '6000W', valor: 390652.76, rep: 'Maiquel' },
  { num: 2182, cli: 'FERKE', dt: '2025-08-26', cod: '135T 3200', modelo: 'DA53T 4+1', valor: 503811.5, rep: 'Maiquel' },
  { num: 2183, cli: 'FERKE', dt: '2025-08-27', cod: '200T 3200', modelo: 'DA53T 4+1', valor: 603339.26, rep: 'Maiquel' },
  { num: 2184, cli: 'BAKY', dt: '2025-08-27', cod: 'GL2000', modelo: 'NACIONALIZADA', valor: 97180.15, rep: 'Maiquel' },
  { num: 2185, cli: 'BAKY', dt: '2025-08-27', cod: 'GM3015SP', modelo: '6000W', valor: 502269.23, rep: 'Maiquel' },
  { num: 2186, cli: 'BAKY', dt: '2025-08-27', cod: 'GL3000', modelo: 'NACIONALIZADA', valor: 162809.92, rep: 'Maiquel' },
  { num: 2187, cli: 'D R SUL', dt: '2025-08-28', cod: 'GM6025D', modelo: '12000W & TIANCHEN', valor: 923908.94, rep: 'Lucas Makinodan' },
  { num: 2188, cli: 'NG', dt: '2025-08-28', cod: 'GM3015D', modelo: '3000W & TIANCHEN', valor: 436920.87, rep: 'Maiquel' },
  { num: 2189, cli: 'NG', dt: '2025-08-28', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 337344.36, rep: 'Maiquel' },
  { num: 2190, cli: 'D R SUL', dt: '2025-08-28', cod: 'W12-6X3000', modelo: 'ESA 860W', valor: 470773.32, rep: 'Lucas Makinodan' },
  { num: 2191, cli: 'D R SUL', dt: '2025-08-28', cod: '160T 3200', modelo: 'DA66S 4+1 TD', valor: 985511.92, rep: 'Lucas Makinodan' },
  { num: 2192, cli: 'D R SUL', dt: '2025-08-28', cod: '300T 6000', modelo: 'DA66S 4+1', valor: 891590.62, rep: 'Lucas Makinodan' },
  { num: 2193, cli: 'D R SUL', dt: '2025-08-28', cod: 'W12-6X3000', modelo: 'ESA 860W', valor: 3199335.16, rep: 'Lucas Makinodan' },
  { num: 2194, cli: 'D R SUL', dt: '2025-08-28', cod: 'W12-6X3000', modelo: 'ESA 860W', valor: 2234024.88, rep: 'Lucas Makinodan' },
  { num: 2195, cli: 'MAXIMA', dt: '2025-08-29', cod: 'TCK56A', modelo: '500MM & FANUC OI MF', valor: 470236.35, rep: 'Maiquel' },
  { num: 2196, cli: 'MAXIMA', dt: '2025-09-01', cod: 'VMC1160', modelo: 'FANUC 0I MF', valor: 547273.7, rep: 'Maiquel' },
  { num: 2197, cli: 'MAXIMA', dt: '2025-09-01', cod: 'VMC1580', modelo: 'FANUC 0I MF', valor: 726115.02, rep: 'Maiquel' },
  { num: 2198, cli: 'MAXIMA', dt: '2025-09-01', cod: 'GMC2014', modelo: 'FANUC 0I MF', valor: 1062853.03, rep: 'Maiquel' },
  { num: 2199, cli: 'TORNEARIA EF', dt: '2025-08-29', cod: 'CAK6160V', modelo: '2000MM & SIEMENS', valor: 445198.56, rep: 'Maiquel' },
  { num: 2200, cli: 'THOR', dt: '2025-09-01', cod: 'GM30W', modelo: 'NACIONALIZADA', valor: 39948.09, rep: 'Maiquel' },
  { num: 2201, cli: 'BERLINERLUFT', dt: '2025-09-04', cod: 'GM5H', modelo: '', valor: 214235.24, rep: 'Gustavo Hainzenreder' },
  { num: 2202, cli: 'METALSUL', dt: '2025-09-08', cod: '40T 2500', modelo: 'E300P XY', valor: 197916.78, rep: 'Gustavo Hainzenreder' },
  { num: 2203, cli: 'FONSECA', dt: '2025-09-08', cod: 'VMC650', modelo: 'SIEMENS 828D', valor: 452265.99, rep: 'Maiquel' },
  { num: 2204, cli: 'MZ', dt: '2025-09-09', cod: 'GM6015D', modelo: '6000W', valor: 614612.65, rep: 'Maiquel' },
  { num: 2205, cli: 'MZ', dt: '2025-09-09', cod: 'GM3015S', modelo: '3000W & TIANCHEN', valor: 304322.3, rep: 'Maiquel' },
  { num: 2206, cli: 'BERLINERLUFT', dt: '2025-09-17', cod: 'GM230', modelo: '2000W & FSCUT 5000', valor: 487104.91, rep: 'Gustavo Hainzenreder' },
];

// Cotações confirmadas como ganhas, com a data do faturamento que provou o
// fechamento (ver cabeçalho).
const GANHAS: Record<number, { closedAt: string; nota: string }> = {
  14: {
    closedAt: '2026-06-08',
    nota: 'Ganha — faturada em junho/2026 em duas notas: R$ 159.667 (matriz, venda 1421) e R$ 319.333 (filial, venda 44).',
  },
};

function dataBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function maisDias(iso: string, dias: number): Date {
  const base = new Date(`${iso}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const tenantContext = app.get(TenantContextService);
    const supabaseUser = app.get(SupabaseUserService);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { id: true },
    });
    const ctx = {
      userId: SYSTEM_ACTOR_USER_ID,
      workspaceId: workspace.id,
      role: 'owner' as const,
    };

    const dados = await tenantContext.run(ctx, async (tx) => {
      const pipeline = await tx.pipeline.findFirstOrThrow({
        where: { workspaceId: workspace.id, isDefault: true },
        select: { id: true, name: true },
      });
      const stages = await tx.stage.findMany({
        where: { pipelineId: pipeline.id },
        select: { id: true, name: true, order: true },
        orderBy: { order: 'asc' },
      });
      const memberships = await tx.membership.findMany({
        where: { workspaceId: workspace.id, status: 'active' },
        select: { userId: true },
      });
      const empresas = await tx.company.findMany({
        where: { workspaceId: workspace.id, deletedAt: null, cpfCnpj: { in: Object.values(CNPJ) } },
        select: { id: true, cpfCnpj: true, razaoSocial: true },
      });
      const jaImportadas = await tx.opportunity.findMany({
        where: { workspaceId: workspace.id, description: { startsWith: 'Cotação ' } },
        select: { description: true },
      });
      return { pipeline, stages, memberships, empresas, jaImportadas };
    });

    // Etapa de destino: a última antes de ganho/perdido — "Negociação e
    // Fechamento". É onde a negociação morre ou fecha, e cria o card com o
    // SLA de proposta já encerrado (decisão 5.11).
    const stage = dados.stages[dados.stages.length - 1];

    const identidades = await supabaseUser.getIdentities(
      dados.memberships.map((m) => m.userId),
    );
    // De-para representante da planilha → membro do CRM. Aceita o nome
    // igual ou só o primeiro nome (no CRM alguns membros estão cadastrados
    // sem sobrenome: "Lauro", "Maiquel", "Darlã").
    const porNome = new Map<string, string>();
    for (const [userId, ident] of identidades) {
      const nome = ident.name?.trim();
      if (!nome) continue;
      porNome.set(nome.toLocaleLowerCase('pt-BR'), userId);
    }
    // Correção do usuário (2026-09-18): onde a planilha diz "Maiquel
    // Camargo", o representante da negociação é o ARLEI. O nome do Maiquel
    // foi usado no campo da cotação porque a proposta impressa já traz o
    // Arlei como gerente — deixar os dois iguais faria o nome dele sair
    // duas vezes no documento.
    const TROCA_REPRESENTANTE: Record<string, string> = { maiquel: 'Arlei' };
    function donoDe(rep: string): string | undefined {
      const original = rep.trim().toLocaleLowerCase('pt-BR');
      const alvo = TROCA_REPRESENTANTE[original.split(' ')[0]] ?? rep;
      const cheio = alvo.trim().toLocaleLowerCase('pt-BR');
      return porNome.get(cheio) ?? porNome.get(cheio.split(' ')[0]);
    }

    const porCnpj = new Map(dados.empresas.map((e) => [e.cpfCnpj as string, e]));
    const numerosJaImportados = new Set(
      dados.jaImportadas
        .map((o) => /^Cotação (\d+)/.exec(o.description ?? '')?.[1])
        .filter((n): n is string => !!n),
    );

    const pendentes: (Cotacao & { companyId: string; ownerUserId: string })[] = [];
    const problemas: string[] = [];

    for (const cot of COTACOES) {
      if (numerosJaImportados.has(String(cot.num))) continue;
      const cnpj = CNPJ[cot.cli];
      const empresa = cnpj ? porCnpj.get(cnpj) : undefined;
      const ownerUserId = donoDe(cot.rep);
      if (!empresa) {
        problemas.push(`Cotação ${cot.num}: empresa não encontrada (${cot.cli}, CNPJ ${cnpj ?? '—'})`);
        continue;
      }
      if (!ownerUserId) {
        problemas.push(`Cotação ${cot.num}: representante sem membro no CRM (${cot.rep})`);
        continue;
      }
      pendentes.push({ ...cot, companyId: empresa.id, ownerUserId });
    }

    const ganhas = pendentes.filter((c) => GANHAS[c.num]);
    console.log(`Pipeline: ${dados.pipeline.name} · etapa de destino: ${stage.name}`);
    console.log(`Cotações na planilha: ${COTACOES.length}`);
    console.log(`Já importadas antes: ${numerosJaImportados.size}`);
    console.log(`A importar agora: ${pendentes.length} (${ganhas.length} ganha(s), ${pendentes.length - ganhas.length} perdida(s))`);
    if (problemas.length > 0) {
      console.log('\nLinhas que NÃO entram:');
      for (const p of problemas) console.log(`  - ${p}`);
    }

    if (!apply) {
      console.log('\nSIMULAÇÃO — nada foi gravado. Rode de novo com --apply.');
      return;
    }
    if (pendentes.length === 0) return;

    await tenantContext.run(
      ctx,
      async (tx) => {
        // Motivo de perda do histórico entra na lista do CRM (a mesma da
        // janela "Por que a negociação foi perdida?", decisão 5.13) — sem
        // isso a Administração mostraria um motivo usado por 122
        // oportunidades e ausente da lista.
        const existente = await tx.opportunityLostReason.findFirst({
          where: { workspaceId: workspace.id, nome: MOTIVO_HISTORICO },
          select: { id: true },
        });
        if (!existente) {
          await tx.opportunityLostReason.create({
            data: { workspaceId: workspace.id, nome: MOTIVO_HISTORICO },
          });
        }

        for (const cot of pendentes) {
          const criadoEm = new Date(`${cot.dt}T12:00:00.000Z`);
          const ganha = GANHAS[cot.num];
          const item = [cot.cod, cot.modelo].filter(Boolean).join(' — ');
          const descricao = [
            `Cotação ${cot.num} de ${dataBR(cot.dt)} — ${item}.`,
            'Importada da planilha de cotações (histórico de jul a set/2025).',
            ganha?.nota,
          ]
            .filter(Boolean)
            .join(' ');

          await tx.opportunity.create({
            data: {
              workspaceId: workspace.id,
              companyId: cot.companyId,
              pipelineId: dados.pipeline.id,
              stageId: stage.id,
              ownerUserId: cot.ownerUserId,
              amount: cot.valor,
              currency: 'BRL',
              description: descricao,
              // Marca de carga histórica (2026-09-18): tira estes cards do
              // funil do Painel, que só conta o ciclo comercial corrente.
              origem: 'historico-cotacoes',
              expectedCloseDate: maisDias(cot.dt, DIAS_CICLO),
              // SLA da proposta encerrado na própria data: card histórico
              // nasce em Negociação, não fica com contagem aberta.
              slaDueDate: criadoEm,
              status: ganha ? 'won' : 'lost',
              lostReason: ganha ? null : MOTIVO_HISTORICO,
              closedAt: ganha ? new Date(`${ganha.closedAt}T12:00:00.000Z`) : maisDias(cot.dt, DIAS_CICLO),
              createdAt: criadoEm,
              updatedAt: criadoEm,
              items: {
                create: { name: item, amount: cot.valor, position: 0 },
              },
            },
          });
        }
      },
      { timeoutMs: 300_000 },
    );

    console.log(`\nGravado: ${pendentes.length} oportunidade(s).`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
