import { gerarRelatorioContatos } from "@/lib/api/relatorios";
import type { Membership } from "@/lib/api/types";
import { memberName } from "../../(administracao)/membros/roles";
import { COLUNAS_CONTATOS, filtroContatos, lerParamsContatos, linhaContato } from "../contatos";
import { faixaPorExtenso, PERIODOS } from "../periodo";
import PersonalizadoAoDigitar from "../personalizado-ao-digitar";

// A tela desenha no máximo isto; o CSV leva tudo. Milhares de linhas numa
// tabela HTML deixam a página pesada sem ninguém ler até o fim.
const LIMITE_TELA = 1000;

// Relatório "Contatos" (pedido do usuário, 2026-09-28) — mesma moldura dos
// outros, mais o botão "Exportar CSV", que baixa o resultado com os mesmos
// filtros.
export default async function RelatorioContatos({
  token,
  params,
  memberships,
}: {
  token: string;
  params: Record<string, string | undefined>;
  memberships: Membership[];
}) {
  const p = lerParamsContatos(params);
  const gerou = params.gerar === "1";
  const ativos = memberships.filter((m) => m.status === "active");

  const relatorio = gerou ? await gerarRelatorioContatos(token, filtroContatos(p)) : null;

  // Mesma querystring da tela, apontada pro download.
  const csv = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor && chave !== "r" && chave !== "gerar") csv.set(chave, valor);
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Filtros</div>
        </div>
        <div className="panel-body">
          <form method="get" action="/dashboard/relatorios" className="rel-filtros">
            <PersonalizadoAoDigitar campo="cadastro" />
            <input type="hidden" name="r" value="contatos" />

            <div className="field">
              <label htmlFor="empresa">Empresa</label>
              <input
                id="empresa"
                type="text"
                name="empresa"
                defaultValue={p.empresa}
                placeholder="parte do nome da empresa"
                maxLength={120}
              />
            </div>

            <div className="field">
              <label htmlFor="contato">Contato</label>
              <input
                id="contato"
                type="text"
                name="contato"
                defaultValue={p.contato}
                placeholder="nome, e-mail ou telefone"
                maxLength={120}
              />
            </div>

            <div className="field">
              <label htmlFor="usuarioId">Responsável</label>
              <select id="usuarioId" name="usuarioId" defaultValue={p.usuarioId}>
                <option value="">Todos os responsáveis</option>
                {ativos.map((m) => (
                  <option key={m.id} value={m.userId}>
                    {memberName(m)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="decisor">Tomador de decisão</label>
              <select id="decisor" name="decisor" defaultValue={p.decisor}>
                <option value="">Todos</option>
                <option value="sim">Só decisores</option>
                <option value="nao">Só não decisores</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="cadastro">Data de cadastro</label>
              <select id="cadastro" name="cadastro" defaultValue={p.cadastro}>
                <option value="">Qualquer data</option>
                {PERIODOS.map((periodo) => (
                  <option key={periodo.valor} value={periodo.valor}>
                    {periodo.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="inicio">Data inicial</label>
              <input id="inicio" type="date" name="inicio" defaultValue={p.faixa?.inicio} />
              <div className="field-hint">Vale quando a data de cadastro é &quot;Personalizado&quot;.</div>
            </div>

            <div className="field">
              <label htmlFor="fim">Data final</label>
              <input id="fim" type="date" name="fim" defaultValue={p.faixa?.fim} />
            </div>

            <div className="rel-filtros-acoes">
              <button type="submit" name="gerar" value="1" className="btn btn-primary">
                Gerar relatório
              </button>
            </div>
          </form>
        </div>
      </div>

      {relatorio && (
        <div className="panel rel-resultado">
          <div className="panel-head">
            <div>
              <div className="panel-title">Contatos</div>
              <div className="sub">
                {p.faixa ? `Cadastrados de ${faixaPorExtenso(p.faixa)} · ` : ""}
                {relatorio.total} contato(s)
              </div>
            </div>
            {relatorio.rows.length > 0 && (
              // Link comum (não client component): o navegador baixa o
              // arquivo que a rota devolve com Content-Disposition.
              <a
                href={`/api/relatorios/contatos?${csv.toString()}`}
                className="btn btn-sm"
                download
              >
                Exportar CSV
              </a>
            )}
          </div>
          <div className="panel-body">
            {relatorio.truncado && (
              <p className="field-hint" style={{ marginBottom: 12 }}>
                O filtro tem mais contatos do que o relatório traz de uma vez. Estreite o filtro
                para ver o restante.
              </p>
            )}
            {relatorio.rows.length > LIMITE_TELA && (
              <p className="field-hint" style={{ marginBottom: 12 }}>
                A tela mostra os primeiros {LIMITE_TELA}. O CSV traz todos os{" "}
                {relatorio.rows.length}.
              </p>
            )}
            {relatorio.rows.length === 0 ? (
              <p className="sub">Nenhum contato com esses filtros.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    {COLUNAS_CONTATOS.map((coluna) => (
                      <th key={coluna}>{coluna}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {relatorio.rows.slice(0, LIMITE_TELA).map((row) => (
                    <tr key={row.id}>
                      {linhaContato(row, memberships).map((valor, i) => (
                        <td key={COLUNAS_CONTATOS[i]}>{valor || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
