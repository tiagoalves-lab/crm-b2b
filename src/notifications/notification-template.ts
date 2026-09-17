import { esc } from '../reports/report-template';

// Avisos pontuais por e-mail (2026-09-15): tarefa designada a alguém e
// membro destacado numa anotação. Valem as mesmas regras de HTML de
// e-mail do resumo diário (ver report-template.ts): estilo inline, layout
// em <table>, fonte do sistema, nada de imagem remota nem JavaScript.
//
// São propositalmente CURTOS: o e-mail avisa e manda de volta pro CRM, não
// tenta substituir a tela. Quem lê no celular precisa entender em duas
// linhas do que se trata.

const COR = {
  texto: '#1a1e24',
  secundario: '#5b6472',
  fraco: '#838c99',
  linha: '#dde1e7',
  linhaSuave: '#e7eaee',
  fundo: '#e8eaee',
  superficie: '#ffffff',
  afundado: '#f4f5f7',
  accent: '#052df4',
  alerta: '#c8402f',
} as const;

const FONTE =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

export interface AvisoTarefa {
  titulo: string;
  empresa: string | null;
  prazo: string | null; // "17/09" — null quando a tarefa não tem prazo
  atrasada: boolean;
  tipo: string | null;
  descricao: string | null;
  designadoPor: string;
  url: string | null;
}

export interface AvisoMencao {
  empresa: string;
  autor: string;
  texto: string;
  url: string | null;
}

function moldura(conteudo: string, titulo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${COR.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${COR.fundo};">
  <tr>
    <td align="center" style="padding: 24px 12px 32px 12px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px; background: ${COR.superficie}; border: 1px solid ${COR.linha};">
        <tr>
          <td style="padding: 18px 22px 20px 22px; border-top: 3px solid ${COR.accent};">
            <div style="font-family: ${FONTE}; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase; color: ${COR.accent}; margin-bottom: 12px;">Gama Brasil · CRM</div>
            ${conteudo}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function botao(url: string | null, rotulo: string): string {
  if (!url) return '';
  return `<div style="margin-top: 18px;"><a href="${esc(url)}" style="display: inline-block; background: ${COR.accent}; color: #ffffff; text-decoration: none; font-family: ${FONTE}; font-size: 13.5px; font-weight: bold; padding: 10px 20px; border-radius: 6px;">${esc(rotulo)}</a></div>`;
}

function rodape(): string {
  return `<div style="font-family: ${FONTE}; font-size: 11.5px; line-height: 1.6; color: ${COR.fraco}; margin-top: 18px; padding-top: 14px; border-top: 1px solid ${COR.linhaSuave};">Aviso automático do CRM da Gama Brasil. Para falar com alguém, é só responder este e-mail.</div>`;
}

function linhaDado(
  rotulo: string,
  valor: string,
  cor: string = COR.texto,
): string {
  return `<tr>
    <td style="font-family: ${FONTE}; font-size: 12px; color: ${COR.fraco}; padding: 0 12px 5px 0; white-space: nowrap; vertical-align: top;">${esc(rotulo)}</td>
    <td style="font-family: ${FONTE}; font-size: 13px; color: ${cor}; padding: 0 0 5px 0; vertical-align: top;">${esc(valor)}</td>
  </tr>`;
}

export function assuntoTarefaAtribuida(aviso: AvisoTarefa): string {
  return `Nova tarefa para você: ${aviso.titulo}`;
}

export function montarTarefaAtribuidaHtml(aviso: AvisoTarefa): string {
  const dados = [
    aviso.empresa ? linhaDado('Empresa', aviso.empresa) : '',
    aviso.tipo ? linhaDado('Tipo', aviso.tipo) : '',
    aviso.prazo
      ? linhaDado(
          'Prazo',
          aviso.atrasada ? `${aviso.prazo} (já vencido)` : aviso.prazo,
          aviso.atrasada ? COR.alerta : COR.texto,
        )
      : linhaDado('Prazo', 'sem prazo definido', COR.fraco),
    linhaDado('Designada por', aviso.designadoPor),
  ].join('');

  const descricao = aviso.descricao
    ? `<div style="font-family: ${FONTE}; font-size: 13px; line-height: 1.55; color: #2f3742; background: ${COR.afundado}; border-left: 3px solid ${COR.linha}; padding: 10px 12px; margin-top: 14px; white-space: pre-line;">${esc(aviso.descricao)}</div>`
    : '';

  return moldura(
    `<div style="font-family: ${FONTE}; font-size: 18px; font-weight: bold; color: ${COR.texto}; line-height: 1.3;">Nova tarefa para você</div>
     <div style="font-family: ${FONTE}; font-size: 15px; color: ${COR.texto}; margin: 6px 0 14px 0;">${esc(aviso.titulo)}</div>
     <table role="presentation" cellpadding="0" cellspacing="0" border="0">${dados}</table>
     ${descricao}
     ${botao(aviso.url, 'Abrir a tarefa')}
     ${rodape()}`,
    assuntoTarefaAtribuida(aviso),
  );
}

export function assuntoMencao(aviso: AvisoMencao): string {
  return `${aviso.autor} destacou você em ${aviso.empresa}`;
}

export function montarMencaoHtml(aviso: AvisoMencao): string {
  return moldura(
    `<div style="font-family: ${FONTE}; font-size: 18px; font-weight: bold; color: ${COR.texto}; line-height: 1.3;">Você foi destacado numa anotação</div>
     <div style="font-family: ${FONTE}; font-size: 13px; color: ${COR.secundario}; margin: 6px 0 14px 0;">${esc(aviso.autor)} · ${esc(aviso.empresa)}</div>
     <div style="font-family: ${FONTE}; font-size: 13.5px; line-height: 1.55; color: #2f3742; background: ${COR.afundado}; border-left: 3px solid ${COR.accent}; padding: 11px 14px; white-space: pre-line;">${esc(aviso.texto)}</div>
     ${botao(aviso.url, 'Abrir a oportunidade')}
     ${rodape()}`,
    assuntoMencao(aviso),
  );
}
