import Link from "next/link";
import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { hasPermission } from "@/lib/api/permission-catalog";
import { listMemberships } from "@/lib/api/memberships";
import TopbarFilter from "@/app/_components/topbar-filter";
import { RELATORIOS, relatorioDe } from "./catalogo";
import RelatorioAnotacoes from "./_relatorios/anotacoes";
import RelatorioContatos from "./_relatorios/contatos";
import RelatorioSlaOportunidades from "./_relatorios/sla-oportunidades";
import RelatorioTarefasConcluidas from "./_relatorios/tarefas-concluidas";

// Tela de Relatórios no molde do eGestor (pedido do usuário, 2026-09-23):
// menu de relatórios fixo à esquerda, painel de filtros do relatório
// escolhido à direita e o resultado logo abaixo dos filtros. Sem nenhum
// relatório escolhido a área fica vazia — indicador de gestão é assunto
// do menu Painel, não daqui.
//
// Tudo por querystring, sem estado no navegador: o relatório gerado tem
// URL própria (dá pra guardar nos favoritos do navegador e reabrir com os
// mesmos filtros) e o formulário é um <form method="get"> comum — nenhum
// JavaScript de cliente pra filtrar.
export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Parâmetro repetido na URL (?tipo=a&tipo=b) chega como array — a tela
  // só trabalha com valor único.
  const params: Record<string, string | undefined> = {};
  for (const [chave, valor] of Object.entries(query)) {
    params[chave] = Array.isArray(valor) ? valor[0] : valor;
  }

  const token = await getServerAccessToken();
  // getMe tem cache() por renderização — o layout do dashboard já buscou.
  const me = await getMe(token);
  // Relatório com caixa própria (ex.: financeiros) some do menu e não
  // abre pela URL pra quem não tem a caixa marcada.
  const disponiveis = RELATORIOS.filter(
    (r) => !r.permission || hasPermission(me.membership.role, me.membership.permissions, r.permission, "ver"),
  );
  const atual = disponiveis.find((r) => r.id === relatorioDe(params.r)?.id) ?? null;
  // Lista de membros só quando algum relatório está aberto: ela alimenta
  // o filtro de pessoa e traduz o id de quem registrou cada linha.
  const memberships = atual ? await listMemberships(token) : [];

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Relatórios</div>
          <div className="page-sub">{atual ? atual.titulo : "Escolha um relatório no menu"}</div>
        </div>
        <TopbarFilter />
      </div>

      <div className="content">
        <div className="rel-layout">
          <aside className="panel rel-menu">
            <div className="panel-head">
              <div className="panel-title">Relatórios</div>
            </div>
            <div className="panel-body">
              {disponiveis.map((item) => (
                <Link
                  key={item.id}
                  href={`/dashboard/relatorios?r=${item.id}`}
                  className={item.id === atual?.id ? "rel-menu-item ativo" : "rel-menu-item"}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </aside>

          <section className="rel-conteudo">
            {atual ? (
              <>
                <div className="rel-cabecalho">
                  <h2>{atual.titulo}</h2>
                  <p>{atual.descricao}</p>
                </div>

                {atual.id === "anotacoes" ? (
                  <RelatorioAnotacoes token={token} params={params} memberships={memberships} />
                ) : atual.id === "contatos" ? (
                  <RelatorioContatos token={token} params={params} memberships={memberships} />
                ) : atual.id === "sla-oportunidades" ? (
                  <RelatorioSlaOportunidades token={token} params={params} memberships={memberships} />
                ) : (
                  <RelatorioTarefasConcluidas
                    token={token}
                    params={params}
                    memberships={memberships}
                  />
                )}
              </>
            ) : (
              <p className="rel-vazio">
                Escolha no menu ao lado o relatório que você quer gerar.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
