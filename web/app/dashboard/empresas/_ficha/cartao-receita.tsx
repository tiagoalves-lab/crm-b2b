import { companyDisplayName } from "@/lib/api/companies";
import type { Company } from "@/lib/api/types";
import { formatDateBR, formatDateOnlyBR } from "@/lib/format-date";
import { updateCustomFieldsAction } from "../actions";
import SubmitButton from "@/app/_components/submit-button";
import ActionForm from "@/app/_components/action-form";

// Enum `indicadorIE` do eGestor (docs/api-egestor-contatos.md: 1 =
// Contribuinte, 2 = Isento de IE, 9 = Não contribuinte) — substituiu o
// checkbox booleano "Contribuinte de ICMS" em 2026-08-17 (decisão do
// usuário). O rótulo é o texto que ele pediu; o valor guardado é só o
// número, que é o que a API do eGestor aceita.
const INDICADOR_IE_OPCOES: Array<{ valor: string; label: string }> = [
  { valor: "1", label: "1 - Contribuinte do ICMS" },
  { valor: "2", label: "2 - Contribuinte Isento" },
  { valor: "9", label: "9 - Não Contribuinte" },
];

// customFields é jsonb — o valor pode voltar como número (o que gravamos)
// ou string. Só 1/2/9 são aceitos; qualquer outra coisa vira "não
// informado", nunca um valor inválido indo parar no ERP.
function indicadorIeSalvo(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return INDICADOR_IE_OPCOES.some((o) => o.valor === texto) ? texto : "";
}

// Snapshot salvo em customFields.cnpj_lookup por refreshCnpjDataAction —
// ver comentário lá (web/app/dashboard/empresas/actions.ts) sobre por que
// isso não vira coluna própria.
interface CnpjLookupSnapshot {
  situacaoCadastral?: string | null;
  dataAbertura?: string | null;
  porte?: string | null;
  naturezaJuridica?: string | null;
  cnaePrincipal?: string | null;
  cnaeSecundarios?: string[];
  estabelecimento?: string | null;
  telefoneReceita?: string | null;
  emailReceita?: string | null;
  fonteFederal?: string;
  buscadoEm?: string;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return formatDateBR(value);
}

function fmtDia(value?: string | null): string {
  if (!value) return "—";
  return formatDateOnlyBR(value);
}

// Cartão da Receita + dados estaduais da aba "Dados cadastrais" — um
// componente só pra ficha da empresa e pra ficha do lead (2026-10-28: o
// lead mostrava uma lista simples e o usuário pediu o mesmo quadro da
// empresa, com a data da consulta). A caixa de busca fica em quem chama:
// na empresa é refreshCnpjDataAction, no lead é LeadCnpjEditor.
export default function CartaoReceita({
  company,
  back,
  vazio = "Clique em Buscar dados acima para puxar a ficha da Receita Federal automaticamente.",
}: {
  company: Company;
  back: string;
  vazio?: string;
}) {
  const cad = company.customFields.cnpj_lookup as CnpjLookupSnapshot | undefined;
  const temIE = Boolean(company.customFields.inscricao_estadual);
  const indicadorIE = indicadorIeSalvo(company.customFields.indicador_ie);
  const indicadorIELabel = INDICADOR_IE_OPCOES.find((o) => o.valor === indicadorIE)?.label;

  return (
    <>
      {/* Indicativo próprio (não depende de ter buscado a Receita nesta
          aba — vem de company.emRecuperacaoJudicial, setado no cadastro
          manual, na importação por planilha ou na busca por CNPJ). */}
      {company.emRecuperacaoJudicial && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          ⚠ Empresa em recuperação judicial na Receita Federal — indicativo removido da razão
          social e mantido só aqui.
        </div>
      )}

      {!cad ? (
        <div className="cad-empty">
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6M9 15h6M9 11h2" />
          </svg>
          <p>Nenhum dado cadastral ainda. {vazio}</p>
        </div>
      ) : (
        <>
          <div className="cad-source">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {cad.fonteFederal ?? "Receita Federal · BrasilAPI"} · consultado em {fmtDate(cad.buscadoEm)}
          </div>
          <div className="cad-grid">
            <div className="cad-cell">
              <div className="cad-k">Razão social</div>
              <div className="cad-v">{company.razaoSocial ?? companyDisplayName(company)}</div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">Nome fantasia</div>
              <div className="cad-v">{company.fantasia ?? "—"}</div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">CNPJ</div>
              <div className="cad-v mono">{company.cpfCnpj ?? "—"}</div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">Situação cadastral</div>
              <div className="cad-v">
                <span className={`badge-contrib ${cad.situacaoCadastral === "ATIVA" ? "sim" : "nao"}`}>
                  {cad.situacaoCadastral ?? "—"}
                </span>
              </div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">Abertura</div>
              <div className="cad-v">{fmtDia(cad.dataAbertura)}</div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">Porte</div>
              <div className="cad-v">{cad.porte ?? "—"}</div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">Estabelecimento</div>
              <div className="cad-v">{cad.estabelecimento ?? "—"}</div>
            </div>
            <div className="cad-cell full">
              <div className="cad-k">Natureza jurídica</div>
              <div className="cad-v">{cad.naturezaJuridica ?? "—"}</div>
            </div>
            <div className="cad-cell full">
              <div className="cad-k">CNAE principal</div>
              <div className="cad-v mono">{cad.cnaePrincipal ?? "—"}</div>
            </div>
            <div className="cad-cell full">
              <div className="cad-k">CNAE secundários</div>
              <div className="cnae-list">
                {cad.cnaeSecundarios && cad.cnaeSecundarios.length > 0 ? (
                  cad.cnaeSecundarios.map((c) => (
                    <span key={c} className="cnae-chip">
                      {c}
                    </span>
                  ))
                ) : (
                  <span className="cad-v">—</span>
                )}
              </div>
            </div>
            <div className="cad-cell full">
              <div className="cad-k">Endereço</div>
              <div className="cad-v">
                {[company.logradouro, company.numero, company.bairro].filter(Boolean).join(", ") || "—"}
                {" · "}
                {company.cep ?? "—"} · {company.cidade ?? "—"}
                {company.uf ? `/${company.uf}` : ""}
              </div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">Telefone (Receita)</div>
              <div className="cad-v">{cad.telefoneReceita ?? "—"}</div>
            </div>
            <div className="cad-cell">
              <div className="cad-k">E-mail (Receita)</div>
              <div className="cad-v">{cad.emailReceita ?? "—"}</div>
            </div>
          </div>
        </>
      )}

      <div className="drawer-section-title" style={{ marginTop: 24 }}>
        Dados estaduais (SEFAZ / ICMS)
      </div>
      <div className="cad-source estadual">
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        Fonte estadual (SINTEGRA) · {temIE ? "preenchido manualmente" : "preenchimento manual — a Receita não fornece IE"}
      </div>

      {temIE || indicadorIELabel ? (
        <div className="cad-grid">
          <div className="cad-cell">
            <div className="cad-k">Inscrição Estadual</div>
            <div className="cad-v mono">
              {temIE ? String(company.customFields.inscricao_estadual) : "—"}
            </div>
          </div>
          <div className="cad-cell full">
            <div className="cad-k">Indicador de IE</div>
            <div className="cad-v">
              {indicadorIELabel ? (
                <span className={`badge-contrib ${indicadorIE === "9" ? "nao" : "sim"}`}>
                  {indicadorIELabel}
                </span>
              ) : (
                "Não informado"
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="cad-empty" style={{ padding: 22 }}>
          <p style={{ marginBottom: 0 }}>
            Inscrição Estadual não preenchida. Consulte no SINTEGRA do estado e registre manualmente
            abaixo.
          </p>
        </div>
      )}

      <ActionForm action={updateCustomFieldsAction} onSuccess="stay" className="form-grid" style={{ marginTop: 14 }}>
        <input type="hidden" name="id" value={company.id} />
        <input type="hidden" name="back" value={back} />
        <label>
          Inscrição Estadual
          <input
            name="inscricao_estadual"
            defaultValue={String(company.customFields.inscricao_estadual ?? "")}
          />
        </label>
        <label>
          Indicador de IE
          <select name="indicador_ie" defaultValue={indicadorIE}>
            <option value="">Não informado</option>
            {INDICADOR_IE_OPCOES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton className="btn btn-primary" pendingLabel="Salvando…">
          Salvar dados estaduais
        </SubmitButton>
      </ActionForm>
    </>
  );
}
