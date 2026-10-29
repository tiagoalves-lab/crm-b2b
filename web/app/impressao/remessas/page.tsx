import type { Metadata } from "next";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { hasPermission } from "@/lib/api/permission-catalog";
import { faixaPorExtenso } from "@/app/dashboard/relatorios/periodo";
import { nomeEstab, semAcento } from "@/app/dashboard/fiscal/_relatorios/formato";
import { buscarRemessas, lerFiltrosRemessas } from "@/app/dashboard/fiscal/_relatorios/remessas";
import {
  passaFiltroAlerta,
  rotuloFiltroAlerta,
  situacoesAlertas,
  textoAlertas,
} from "@/app/dashboard/fiscal/_relatorios/alertas-remessa";
import RelatorioRemessas from "./relatorio";

// Controle de remessas pra imprimir ou salvar em PDF e mandar pra
// contabilidade (pedido do usuário, 2026-10-26). Fora do layout do
// dashboard de propósito: sem menu lateral, só o documento. Mesmos
// filtros da tela (lerFiltrosRemessas) mais os de empresa, item e alerta,
// que na tela são feitos na hora.

type Params = Promise<Record<string, string | string[] | undefined>>;

const ROTULO_LADO: Record<string, string> = {
  "": "Saída e entrada",
  enviada: "Saída (a Gama enviou)",
  recebida: "Entrada (a Gama recebeu)",
};
const ROTULO_RETORNO: Record<string, string> = { todas: "Todas", pendente: "Pendentes", retornada: "Retornadas" };

function lerParams(query: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  for (const [chave, valor] of Object.entries(query)) params[chave] = Array.isArray(valor) ? valor[0] : valor;
  return params;
}

// O título vira o nome sugerido do arquivo no "Salvar como PDF".
export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const { faixa } = lerFiltrosRemessas(lerParams(await searchParams));
  const br = (dia: string) => dia.split("-").reverse().join("-");
  return { title: `Controle de remessas - Gama Brasil - ${br(faixa.inicio)} a ${br(faixa.fim)}` };
}

export default async function ImpressaoRemessas({ searchParams }: { searchParams: Params }) {
  const params = lerParams(await searchParams);
  const token = await getServerAccessToken();
  const me = await getMe(token);
  if (!hasPermission(me.membership.role, me.membership.permissions, "fiscal", "ver")) {
    return (
      <div className="impressao">
        <div className="error-banner">Sem permissão para o Console fiscal.</div>
      </div>
    );
  }

  const filtros = lerFiltrosRemessas(params);
  const controle = await buscarRemessas(token, filtros);
  const empresa = (params.empresa ?? "").trim();
  const item = (params.item ?? "").trim();
  const alerta = (params.alerta ?? "").trim();
  const situacoes = situacoesAlertas(controle.rows, controle.alertasLog);
  const linhas = controle.rows.filter(
    (r) =>
      (!empresa || semAcento(r.contraparte ?? "").includes(semAcento(empresa))) &&
      (!item || r.itens.some((i) => semAcento(i).includes(semAcento(item)))) &&
      passaFiltroAlerta(alerta, situacoes.get(r.chave)),
  );
  // Texto do sinal de alerta de cada linha impressa, pra coluna Alertas.
  const alertas = new Map(
    linhas.map((r) => {
      const s = situacoes.get(r.chave);
      return [r.chave, s ? textoAlertas(s) : []] as const;
    }),
  );

  const filtrosTexto = [
    `Período: ${faixaPorExtenso(controle)}`,
    `Estabelecimento: ${filtros.estabelecimento ? nomeEstab(filtros.estabelecimento) : "Matriz e Filial"}`,
    `Remessa: ${ROTULO_LADO[filtros.lado]}`,
    `Retorno: ${ROTULO_RETORNO[filtros.retorno]}`,
    empresa && `Empresa: ${empresa}`,
    item && `Item: ${item}`,
    alerta && `Alerta: ${rotuloFiltroAlerta(alerta)}`,
  ].filter(Boolean);

  return (
    <RelatorioRemessas
      linhas={linhas}
      alertas={alertas}
      filtrosTexto={filtrosTexto}
      truncado={controle.truncado}
      geradoPor={me.user.name ?? me.user.email ?? ""}
    />
  );
}
