import SubmitButton from "@/app/_components/submit-button";
import { getServerAccessToken } from "@/lib/api/auth";
import { getStatusCarga, type StatusCarga } from "@/lib/api/fiscal";
import { getMe } from "@/lib/api/me";
import { hasPermission } from "@/lib/api/permission-catalog";
import { formatDateTimeBR } from "@/lib/format-date";
import { atualizarNotasAction } from "./actions";
import { PAGINA } from "./_relatorios/formato";
import NotasEntrada from "./_relatorios/notas-entrada";
import RelatorioNotasReceita from "./_relatorios/notas-receita";
import ConsultaNotasTela from "./_relatorios/consulta-notas";
import ControleRemessas from "./_relatorios/remessas";
import MenuFiscal from "./menu-fiscal";

// Console fiscal (docs/console-fiscal.md, decisão 7.1): abas no topo e a
// tela escolhida embaixo, na largura toda, tudo por querystring (?r=...).
//
// Em produção desde 2026-10-22 (aprovado no beta). Ver: permissão
// "fiscal"; ligar retorno: "fiscal" editar; atualizar: owner/admin. Quem
// manda de verdade é o backend (403) — o que está aqui é só não mostrar.

const TELAS = [
  {
    id: "receita",
    label: "Resumo de notas emitidas",
    descricao:
      "NF-e com CFOP de receita e NFS-e — a base do PIS e da COFINS. Nota de remessa, transferência e retorno fica de fora.",
  },
  {
    id: "remessas",
    label: "Controle de remessas",
    descricao:
      "Remessas que exigem retorno — as que a Gama mandou e têm que voltar, e as que a Gama recebeu e tem que devolver. Quando a nota de retorno cita a remessa, o vínculo já vem pronto; as demais você liga arrastando a nota da coluna da direita para a linha da remessa.",
  },
  {
    id: "entradas",
    label: "Notas de entrada",
    descricao:
      "NF-e que a Gama recebeu de fornecedores e as de entrada que ela mesma emite (importação, devolução, retorno). Como no eGestor elas nem sempre são lançadas — ou são lançadas só em parte —, cada item recebe aqui uma classificação. Quando o CFOP já diz o que a nota é, ou o fornecedor já foi classificado antes, o CRM sugere e você só confirma.",
  },
  {
    id: "consulta",
    label: "Consultar notas",
    descricao:
      "Pesquisa em todas as notas da base: emitidas e recebidas, NF-e e NFS-e, Matriz e Filial. O que ficar em branco não filtra.",
  },
] as const;

export default async function ConsoleFiscalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Parâmetro repetido na URL chega como array — a tela só usa valor único.
  const params: Record<string, string | undefined> = {};
  for (const [chave, valor] of Object.entries(query)) {
    params[chave] = Array.isArray(valor) ? valor[0] : valor;
  }

  const token = await getServerAccessToken();
  const me = await getMe(token);
  const { role, permissions } = me.membership;

  if (!hasPermission(role, permissions, "fiscal", "ver")) {
    return (
      <div className="content">
        <div className="error-banner">Sem permissão para o Console fiscal.</div>
      </div>
    );
  }
  const podeAtualizar = role === "owner" || role === "admin";
  const podeEditar = hasPermission(role, permissions, "fiscal", "editar");
  const atual = TELAS.find((t) => t.id === params.r) ?? TELAS[0];
  const status = await getStatusCarga(token);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Console fiscal</div>
          <div className="page-sub">Notas emitidas e recebidas pela Gama (Matriz e Filial), vindas do eGestor</div>
        </div>
        {podeAtualizar && (
          <form action={atualizarNotasAction}>
            <SubmitButton className="btn" pendingLabel="Disparando…" disabled={status.emAndamento}>
              {status.emAndamento ? "Atualizando…" : "Atualizar notas"}
            </SubmitButton>
          </form>
        )}
      </div>

      <div className="content">
        <StatusLinha status={status} />

        <nav className="view-tabs fiscal-abas" aria-label="Telas do Console fiscal">
          <MenuFiscal
            itens={TELAS.map((t) => ({ id: t.id, label: t.label, href: `${PAGINA}?r=${t.id}` }))}
            ativo={atual.id}
          />
        </nav>

        <div>
          <section className="rel-conteudo">
            <div className="rel-cabecalho">
              <h2>{atual.label}</h2>
              <p>{atual.descricao}</p>
            </div>

            {atual.id === "receita" ? (
              <RelatorioNotasReceita token={token} params={params} />
            ) : atual.id === "consulta" ? (
              <ConsultaNotasTela token={token} params={params} />
            ) : atual.id === "entradas" ? (
              <NotasEntrada token={token} params={params} podeEditar={podeEditar} />
            ) : (
              <ControleRemessas token={token} params={params} podeEditar={podeEditar} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function StatusLinha({ status }: { status: StatusCarga }) {
  if (status.emAndamento) {
    return (
      <p className="t-sub" style={{ marginBottom: 12 }}>
        Atualizando agora: {status.etapa} ({status.processadas} de {status.total}). Recarregue a página para
        acompanhar.
      </p>
    );
  }
  if (status.erro) {
    return <div className="error-banner">A última atualização parou com erro: {status.erro}</div>;
  }
  if (status.ultima) {
    const falhas = status.ultima.falhas.length;
    return (
      <p className="t-sub" style={{ marginBottom: 12 }}>
        Última atualização: {formatDateTimeBR(status.ultima.concluidaEm)}
        {falhas > 0 ? ` — ${falhas} nota(s) com falha, entram de novo na próxima atualização` : ""}
      </p>
    );
  }
  return null;
}
