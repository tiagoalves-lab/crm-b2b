"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { CnpjLookupResult } from "@/lib/api/companies";
import type { CrmContatoFonte, EgestorContatoConsolidado } from "@/lib/api/types";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import ConfirmSubmitButton from "../../../membros/confirm-submit-button";
import {
  consolidarEgestorAction,
  corrigirEgestorCrmAction,
  correctEgestorAction,
} from "../../actions";

// Mesma lista de rótulos do relatório (page.tsx) — mantida separada de
// propósito: são dois componentes pequenos, não vale criar um módulo só
// pra isso ainda.
const CAMPO_LABEL: Record<string, string> = {
  nome: "Nome",
  fantasia: "Fantasia",
  nomeParaContato: "Nome pra contato",
  cpfcnpj: "CPF/CNPJ",
  tipo: "Tipo",
  dtNasc: "Data de nascimento",
  emails: "E-mails",
  fones: "Telefones",
  logradouro: "Logradouro",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  cep: "CEP",
  codIBGE: "Código IBGE",
  uf: "UF",
  clienteFinal: "Cliente final",
  indicadorIE: "Indicador de IE",
  inscricaoMunicipal: "Inscrição municipal",
  inscricaoEstadual: "Inscrição estadual",
  obs: "Observações",
  tags: "Tags",
};

// Mesma lista de CAMPOS_ARRAY do backend (egestor.types.ts) — mantida
// separada de propósito, mesmo critério de CAMPO_LABEL acima. Únicos
// campos onde "Consolidar" (unir os dois lados) faz sentido — campo
// escalar não tem como "unir" duas strings diferentes.
const CAMPOS_ARRAY = new Set(["emails", "fones", "tags", "tipo"]);

// Mesma lista de CAMPOS_SEFAZ do backend (egestor-contato-correction.
// service.ts) — mantida separada de propósito. Mapeia campo do eGestor →
// chave do CnpjLookupResult (cartão CNPJ, Receita Federal via BrasilAPI —
// não SEFAZ de verdade, ver comentário do backend). Só campo de cadastro
// formal; nunca e-mail/telefone (o da Receita costuma ser do contador).
const CAMPOS_SEFAZ: Partial<Record<string, keyof CnpjLookupResult>> = {
  nome: "razaoSocial",
  fantasia: "fantasia",
  logradouro: "logradouro",
  numero: "numero",
  complemento: "complemento",
  bairro: "bairro",
  cep: "cep",
  uf: "uf",
};

// Campo do eGestor → chave de CrmContatoFonte, pra EXIBIR na coluna "CRM"
// da tabela de comparação. Maior que o mapa de escrita do backend
// (CAMPOS_CRM_ESCRITA) de propósito: mostrar é sempre seguro, gravar não
// (`cidade` o eGestor deriva do codIBGE, `cpfcnpj` é a chave de
// consolidação, `emails`/`fones` são lista e sobrescrever apagaria o que
// só existe no eGestor — pra esses o caminho é "Consolidar").
// Corrigido em 2026-08-14: faltavam nomeParaContato/emails/fones/cidade/
// cpfcnpj/inscricaoEstadual. Em 2026-08-17 entrou `indicadorIE` (vem do
// bloco "Dados estaduais" da ficha da empresa) — era o campo que deixava a
// coluna "CRM" inteira em branco nas linhas que só divergiam em
// fantasia/indicadorIE/inscricaoEstadual.
const CAMPOS_CRM: Partial<Record<string, keyof CrmContatoFonte>> = {
  nome: "razaoSocial",
  fantasia: "fantasia",
  nomeParaContato: "nomeParaContato",
  cpfcnpj: "cpfCnpj",
  emails: "emails",
  fones: "fones",
  logradouro: "logradouro",
  numero: "numero",
  complemento: "complemento",
  bairro: "bairro",
  cep: "cep",
  cidade: "cidade",
  uf: "uf",
  inscricaoEstadual: "inscricaoEstadual",
  indicadorIE: "indicadorIE",
};

// Onde preencher, na ficha da empresa, o campo que está vazio no CRM —
// usado na coluna "CRM" da tabela (2026-08-17). Sem isso a coluna só
// mostrava "—" e não dava pra saber se o CRM não guarda aquele campo ou
// se ele só está em branco no cadastro (foi exatamente a dúvida do
// usuário). Só os campos que a ficha de fato tem onde receber.
const ONDE_PREENCHER_NO_CRM: Partial<Record<string, string>> = {
  nome: "Editar › Razão social",
  fantasia: "Editar › Nome fantasia",
  nomeParaContato: "Editar › Nome para contato",
  logradouro: "Editar › Endereço",
  numero: "Editar › Endereço",
  complemento: "Editar › Endereço",
  bairro: "Editar › Endereço",
  cep: "Editar › Endereço",
  uf: "Editar › Endereço",
  inscricaoEstadual: "Dados cadastrais › Dados estaduais",
  indicadorIE: "Dados cadastrais › Dados estaduais › Indicador de IE",
};

type Direcao = "matriz_para_filial" | "filial_para_matriz" | "crm";

type SefazPreview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: CnpjLookupResult }
  | { status: "error"; message: string };

// Enum do eGestor (docs/api-egestor-contatos.md) — "1"/"9" cru na tabela
// não diz nada pra quem lê a tela.
const INDICADOR_IE_LABEL: Record<string, string> = {
  "1": "1 - Contribuinte do ICMS",
  "2": "2 - Contribuinte Isento",
  "9": "9 - Não Contribuinte",
};

function textoDoValor(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  if (Array.isArray(valor)) return valor.length > 0 ? JSON.stringify(valor) : "";
  const texto = String(valor);
  if (campo === "indicadorIE") return INDICADOR_IE_LABEL[texto] ?? texto;
  return texto;
}

function formatarValor(campo: string, valor: unknown): string {
  return textoDoValor(campo, valor) || "—";
}

// Célula em branco explicada, em vez do "—" mudo que as colunas CRM/SEFAZ
// mostravam pra três situações bem diferentes (2026-08-17, achado do
// usuário: ele viu a coluna "CRM" inteira vazia e não tinha como saber se
// era falha da tela, campo que o CRM não guarda, ou cadastro em branco).
function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>{children}</span>
  );
}

function CelulaSefaz({ campo, sefaz }: { campo: string; sefaz: SefazPreview }) {
  const chave = CAMPOS_SEFAZ[campo];
  if (!chave) return <Vazio>fora do cartão CNPJ</Vazio>;
  if (sefaz.status !== "done") return <>—</>;
  const texto = textoDoValor(campo, sefaz.data[chave]);
  return texto ? <>{texto}</> : <Vazio>em branco na Receita</Vazio>;
}

// Aviso de "gravando" enquanto a Server Action corre. Componente separado
// porque `useFormStatus` lê o <form> ANCESTRAL — chamado dentro do próprio
// CorrectForm devolveria sempre pending:false. Vai logo acima do rodapé,
// perto do botão que foi clicado: escrever no eGestor são vários
// round-trips até o ERP e pode passar de dez segundos, e até 2026-08-17 o
// único sinal era o botão desabilitar, o que o usuário leu como travamento.
function AvisoGravando() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="busy-banner" role="status" aria-live="polite">
      Gravando no eGestor… a resposta depende da API do ERP e pode levar alguns segundos. Não feche
      esta janela.
    </div>
  );
}

function CelulaCrm({ campo, crm }: { campo: string; crm: CrmContatoFonte | null }) {
  if (!crm) return <Vazio>nenhuma empresa no CRM com este CNPJ</Vazio>;
  const chave = CAMPOS_CRM[campo];
  if (!chave) return <Vazio>o CRM não guarda este campo</Vazio>;
  // emails/fones são array em Company — mesmo formato de exibição das
  // colunas Matriz/Filial, pra dar pra comparar lado a lado.
  const texto = textoDoValor(campo, crm[chave]);
  if (texto) return <>{texto}</>;
  const onde = ONDE_PREENCHER_NO_CRM[campo];
  return <Vazio>em branco no cadastro{onde ? ` · ${onde}` : ""}</Vazio>;
}

// Compartilhado entre a versão full-page e a versão modal — escreve de
// volta num ERP de produção de terceiro (docs/roadmap.md, item 9.6), por
// isso o confirm() explícito antes de submeter.
//
// useActionState + router.back() (não redirect() puro, ver comentário em
// ../../actions.ts#correctEgestorAction) — mesmo padrão dos forms de
// criação (ex. LeadForm): fecha o modal sozinho e mostra o toast de
// confirmação só depois do backend confirmar sucesso.
export default function CorrectForm({ row }: { row: EgestorContatoConsolidado }) {
  const router = useRouter();

  // Matriz×Filial (só isso alimenta "Copiar da Matriz/Filial" e
  // "Consolidar" — os dois genuinamente exigem os lados discordando entre
  // si) — separado da lista pra RENDERIZAR a tabela abaixo, que também
  // inclui campo onde Matriz==Filial mas os dois divergem do CRM (pedido
  // do usuário, 2026-08-14): sem isso, a linha nem chegava a esta tela
  // (nenhum campo pra mostrar) mesmo quando havia o que corrigir via CRM.
  const camposMatrizFilial = row.camposDiferentes;
  const camposParaTabela = Array.from(
    new Set([...camposMatrizFilial, ...row.crmCamposDivergentes]),
  );
  const camposConsolidaveis = camposMatrizFilial.filter((c) => CAMPOS_ARRAY.has(c));
  // Já vem calculado do backend (listar()) comparando o CRM contra Matriz
  // E Filial independentemente — não filtrado por camposMatrizFilial.
  const camposCrmAplicaveis = row.crmCamposDivergentes;
  // Matriz==Filial (status ambos_iguais) — não há o que copiar de um lado
  // pro outro, só faz sentido chegar aqui via divergência do CRM.
  const matrizFilialDivergem = row.status === "ambos_diferentes";
  const crmIndisponivel = !row.crm || camposCrmAplicaveis.length === 0;

  const [direcao, setDirecao] = useState<Direcao>(
    matrizFilialDivergem ? "matriz_para_filial" : "crm",
  );
  const [sefaz, setSefaz] = useState<SefazPreview>({ status: "idle" });

  const [state, formAction] = useActionState(correctEgestorAction, null);
  const [consolidarState, consolidarFormAction] = useActionState(consolidarEgestorAction, null);
  const [crmState, crmFormAction] = useActionState(corrigirEgestorCrmAction, null);

  // O sucesso fecha o modal e mostra o toast (efeitos abaixo); o erro fica
  // NESTA tela, e no topo dela — num modal alto como este ele pode nascer
  // fora do campo de visão de quem acabou de clicar no rodapé. Sem rolar
  // até ele, a falha parece silêncio.
  const avisosRef = useRef<HTMLDivElement>(null);
  const houveErro =
    state?.ok === false || consolidarState?.ok === false || crmState?.ok === false;

  useEffect(() => {
    if (houveErro) {
      avisosRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [houveErro, state, consolidarState, crmState]);

  useEffect(() => {
    if (state?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, state.message);
      router.back();
    }
  }, [state, router]);

  useEffect(() => {
    if (consolidarState?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, consolidarState.message);
      router.back();
    }
  }, [consolidarState, router]);

  useEffect(() => {
    if (crmState?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, crmState.message);
      router.back();
    }
  }, [crmState, router]);

  async function consultarSefaz() {
    setSefaz({ status: "loading" });
    try {
      const res = await fetch(`/api/cnpj?cnpj=${row.cpfCnpj}`);
      const data = (await res.json()) as CnpjLookupResult & { message?: string };
      if (!res.ok) {
        setSefaz({ status: "error", message: data.message ?? "Não foi possível consultar o CNPJ." });
        return;
      }
      setSefaz({ status: "done", data });
    } catch {
      setSefaz({ status: "error", message: "Erro ao consultar o CNPJ." });
    }
  }

  const activeFormAction = direcao === "crm" ? crmFormAction : formAction;

  return (
    <form action={activeFormAction}>
      <input type="hidden" name="id" value={row.id} />

      <div className="field-hint" style={{ marginBottom: 12 }}>
        CNPJ {row.cpfCnpj} — Matriz #{row.codigoMatriz} × Filial #{row.codigoFilial}
      </div>

      <div ref={avisosRef}>
        {state?.ok === false && <div className="error-banner">{state.message}</div>}
        {consolidarState?.ok === false && <div className="error-banner">{consolidarState.message}</div>}
        {crmState?.ok === false && <div className="error-banner">{crmState.message}</div>}
        {sefaz.status === "error" && <div className="error-banner">{sefaz.message}</div>}
      </div>

      <div className="row-form" style={{ marginBottom: 12, alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void consultarSefaz()}
          disabled={sefaz.status === "loading"}
        >
          {sefaz.status === "loading" ? "Consultando…" : "Consultar SEFAZ (cartão CNPJ)"}
        </button>
        {sefaz.status === "done" && (
          <span className="field-hint" style={{ margin: 0 }}>
            Consultado — Receita Federal via BrasilAPI (não é a SEFAZ estadual de verdade, é o
            termo popular pro cadastro oficial do CNPJ).
          </span>
        )}
      </div>

      <table className="data-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Campo</th>
            <th>Matriz</th>
            <th>Filial</th>
            <th>CRM</th>
            {sefaz.status !== "idle" && <th>SEFAZ (Receita Federal)</th>}
          </tr>
        </thead>
        <tbody>
          {camposParaTabela.map((campo) => (
            <tr key={campo}>
              <td>{CAMPO_LABEL[campo] ?? campo}</td>
              <td>{formatarValor(campo, row.dadosMatriz?.[campo])}</td>
              <td>{formatarValor(campo, row.dadosFilial?.[campo])}</td>
              <td>
                <CelulaCrm campo={campo} crm={row.crm} />
              </td>
              {sefaz.status !== "idle" && (
                <td>
                  <CelulaSefaz campo={campo} sefaz={sefaz} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {!matrizFilialDivergem && (
        <div className="field-hint" style={{ marginBottom: 8 }}>
          Matriz e Filial já são iguais entre si — não há o que copiar de um lado pro outro
          (&ldquo;Copiar da Matriz/Filial&rdquo; e &ldquo;Consolidar&rdquo; ficam desabilitados
          abaixo). Os dois divergem do CRM — use &ldquo;Copiar do CRM&rdquo;.
        </div>
      )}

      <div className="field">
        <label>Direção da correção</label>
        <label className={`choice${matrizFilialDivergem ? "" : " is-disabled"}`}>
          <input
            type="radio"
            name="direcao"
            value="matriz_para_filial"
            checked={direcao === "matriz_para_filial"}
            onChange={() => setDirecao("matriz_para_filial")}
            disabled={!matrizFilialDivergem}
          />
          <span>
            Copiar da Matriz pra Filial
            <span className="choice-note">
              Recomendado — a Matriz é o registro determinante (ver Empresas).
            </span>
          </span>
        </label>
        <label className={`choice${matrizFilialDivergem ? "" : " is-disabled"}`}>
          <input
            type="radio"
            name="direcao"
            value="filial_para_matriz"
            checked={direcao === "filial_para_matriz"}
            onChange={() => setDirecao("filial_para_matriz")}
            disabled={!matrizFilialDivergem}
          />
          <span>Copiar da Filial pra Matriz</span>
        </label>
        <label className={`choice${crmIndisponivel ? " is-disabled" : ""}`}>
          <input
            type="radio"
            name="direcao"
            value="crm"
            checked={direcao === "crm"}
            onChange={() => setDirecao("crm")}
            disabled={crmIndisponivel}
          />
          <span>
            Copiar do CRM
            <span className="choice-note">
              Corrige Matriz e/ou Filial, o que estiver errado — mesmo que os dois já sejam iguais
              entre si.
            </span>
          </span>
        </label>
        {/* Fora do <label> de propósito: link dentro do rótulo do rádio
            faria o clique marcar a opção em vez de navegar. */}
        {crmIndisponivel && (
          <div className="field-hint" style={{ marginTop: 8 }}>
            {!row.crm ? (
              "Nenhuma empresa cadastrada no CRM com este CNPJ — por isso a coluna CRM está vazia."
            ) : (
              <>
                O cadastro no CRM não tem valor pra nenhum dos campos divergentes desta linha (ver a
                coluna CRM acima). Preencha na ficha da empresa e volte aqui.
                {row.companyId && (
                  <>
                    {" "}
                    <Link href={`/dashboard/empresas/${row.companyId}?aba=cadastro`}>
                      Abrir a ficha da empresa
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="field-hint">
        {direcao === "crm" ? (
          <>
            Compara {camposCrmAplicaveis.length} campo(s) do cadastro desta empresa no CRM (aba
            &ldquo;Dados cadastrais&rdquo;) contra o que está na Matriz e na Filial — corrige só
            o(s) lado(s) que estiver(em) diferente(s) do CRM. Detecta mesmo quando Matriz e Filial
            já são iguais entre si (grava nos dois nesse caso). Atualiza só o eGestor — o cadastro
            do CRM já é a fonte, não muda. Campo em branco no CRM <strong>apaga</strong> o valor
            correspondente no eGestor; razão social, inscrição estadual e indicador de IE são a
            exceção — em branco ali, ficam como estão.
          </>
        ) : (
          <>
            Grava os {camposMatrizFilial.length} campo(s) divergente(s) de volta no eGestor (PUT
            direto na conta de destino).
          </>
        )}{" "}
        Ação real em ERP de produção — não é reversível automaticamente pelo CRM.
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label>Ou consolide (une os dois lados, sem escolher direção)</label>
        <div className="field-hint">
          {camposConsolidaveis.length > 0 ? (
            <>
              Une {camposConsolidaveis.map((c) => CAMPO_LABEL[c] ?? c).join(", ")}{" "}
              dos dois lados num só valor, gravado tanto na Matriz quanto na
              Filial (nenhum dos dois perde dado — ex.: 2 e-mails diferentes
              viram os 2 e-mails nos dois cadastros).
              {camposMatrizFilial.length > camposConsolidaveis.length &&
                " Os demais campos divergentes desta linha continuam precisando de \"Corrigir\" — consolidar não se aplica a campo de texto único."}
            </>
          ) : matrizFilialDivergem ? (
            "Nenhum dos campos divergentes desta linha é de lista (e-mails, telefones, tags, tipo) — \"Consolidar\" só se aplica a esse tipo de campo."
          ) : (
            "Matriz e Filial já são iguais entre si — nada a consolidar."
          )}
        </div>
      </div>

      <AvisoGravando />

      <div className="modal-foot" style={{ padding: "16px 0 0" }}>
        <Link href="/dashboard/integracao-egestor" className="btn btn-ghost">
          Voltar
        </Link>
        <ConfirmSubmitButton
          formAction={consolidarFormAction}
          confirmMessage="Confirma consolidar? Une os campos de lista nos dois lados e grava nos dois contatos do eGestor de produção agora."
          className="btn btn-ghost"
          title={
            camposConsolidaveis.length === 0
              ? "Nenhum campo divergente desta linha é de lista (e-mails/telefones/tags/tipo)"
              : undefined
          }
          disabled={camposConsolidaveis.length === 0}
          pendingLabel="Gravando…"
        >
          Consolidar
        </ConfirmSubmitButton>
        <ConfirmSubmitButton
          formAction={activeFormAction}
          confirmMessage={
            direcao === "crm"
              ? "Confirma corrigir com o CRM? Compara o cadastro desta empresa no CRM com Matriz e Filial e grava no(s) lado(s) que estiver(em) errado(s), no eGestor de produção agora."
              : "Confirma a correção? Isso grava de volta no eGestor de produção agora."
          }
          className="btn btn-primary"
          pendingLabel="Gravando no eGestor…"
        >
          Corrigir no eGestor
        </ConfirmSubmitButton>
      </div>
    </form>
  );
}
