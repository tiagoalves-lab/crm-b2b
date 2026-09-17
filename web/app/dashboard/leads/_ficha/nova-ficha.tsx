"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OverlayDrawer from "@/app/dashboard/_overlay/overlay-drawer";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { CnpjLookupResult } from "@/lib/api/companies";
import { createLeadAction } from "../actions";
import { cadastroFromLookup, formatCnpj, PORTES, SITUACOES } from "../cnpj-lookup-fields";
import { ABAS, type Aba } from "./ficha-tabs";

// Cadastro de empresa nova na Prospecção (2026-09-14, pedido do usuário):
// o antigo formulário em modal ("Nova empresa") foi apagado e o cadastro
// passou a acontecer na própria ficha do lead — mesma moldura de
// leads/[id] (cabeçalho + abas + corpo), já aberta em "Dados cadastrais".
// As outras abas (Timeline, Contatos, Tarefas) dependem de um registro
// existente, então ficam travadas até salvar: clicar nelas abre um aviso
// oferecendo salvar na hora e abrir a aba em seguida.
//
// Depois de salvar, a tela vira a ficha de verdade (/dashboard/leads/:id)
// no mesmo formato em que estava — drawer continua drawer (ver salvar()).

const FORM_ID = "nova-empresa-form";

type Fields = {
  razaoSocial: string;
  cnpj: string;
  cnaePrincipal: string;
  cnaeDescricao: string;
  porte: string;
  situacao: string;
  uf: string;
  municipio: string;
};

// Campos de texto livre do cadastro que viram caixa alta ao digitar
// (pedido do usuário, 2026-08-10) — mesmo escopo do
// RawLeadService#upperCaseTextFields no backend. Fora: cnpj (dígito, não
// texto de cadastro) e os <select> (porte/situação), que já só têm opções
// fixas em maiúsculo.
const UPPERCASE_FIELDS = new Set<keyof Fields>([
  "razaoSocial",
  "cnaePrincipal",
  "cnaeDescricao",
  "uf",
  "municipio",
]);

const EMPTY_FIELDS: Fields = {
  razaoSocial: "",
  cnpj: "",
  cnaePrincipal: "",
  cnaeDescricao: "",
  porte: "",
  situacao: "ATIVA",
  uf: "",
  municipio: "",
};

function vazioParaUndefined(value: string): string | undefined {
  const str = value.trim();
  return str === "" ? undefined : str;
}

export default function NovaLeadFicha({ variant }: { variant: "drawer" | "page" }) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [cnpjQuery, setCnpjQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Aba que o usuário tentou abrir antes de salvar — enquanto estiver
  // preenchida, o aviso "Salve o registro primeiro" fica na tela.
  const [abaBloqueada, setAbaBloqueada] = useState<Aba | null>(null);
  // Hint pro backend não redetectar "EM RECUPERAÇÃO JUDICIAL" a partir de
  // um razaoSocial que a busca por CNPJ já devolve limpo (ver
  // CnpjLookupResult#emRecuperacaoJudicial) — undefined quando o usuário
  // nunca buscou por CNPJ ou editou a razão social manualmente depois
  // (nesse caso o backend autodetecta a partir do texto final mesmo).
  const [rjHint, setRjHint] = useState<boolean | undefined>(undefined);

  // Esc com o aviso aberto fecha só o aviso. Sem isto o listener do
  // OverlayDrawer (document, fase de bolha) fecharia o drawer inteiro e o
  // cadastro digitado ia junto — daí o listener em fase de captura, que
  // roda antes e interrompe a propagação.
  useEffect(() => {
    if (!abaBloqueada) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setAbaBloqueada(null);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [abaBloqueada]);

  const field = (name: keyof Fields) => ({
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      // Editar a razão social manualmente depois da busca por CNPJ invalida
      // o hint (o texto que será submetido não é mais garantidamente o que
      // a Receita devolveu) — o backend volta a autodetectar a partir do
      // texto final.
      if (name === "razaoSocial") setRjHint(undefined);
      const value = UPPERCASE_FIELDS.has(name) ? e.target.value.toUpperCase() : e.target.value;
      setFields((prev) => ({ ...prev, [name]: value }));
    },
  });

  async function buscarCnpj() {
    const digits = cnpjQuery.replace(/\D/g, "");
    if (digits.length !== 14) {
      setLookupError("CNPJ precisa ter 14 dígitos.");
      return;
    }
    setLoading(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/cnpj?cnpj=${digits}`);
      const data = (await res.json()) as CnpjLookupResult & { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? "Não foi possível consultar o CNPJ.");
      }
      // cadastroFromLookup já devolve tudo em caixa alta (mesma
      // padronização do field() acima) — a Receita devolve razão
      // social/município em texto misto.
      const cadastro = cadastroFromLookup(data);
      setFields((prev) => ({
        ...prev,
        razaoSocial: cadastro.razaoSocial ?? prev.razaoSocial,
        cnpj: cadastro.cnpj || prev.cnpj,
        cnaePrincipal: cadastro.cnaePrincipal ?? prev.cnaePrincipal,
        cnaeDescricao: cadastro.cnaeDescricao ?? prev.cnaeDescricao,
        porte: cadastro.porte ?? prev.porte,
        situacao: cadastro.situacao,
        uf: cadastro.uf ?? prev.uf,
        municipio: cadastro.municipio ?? prev.municipio,
      }));
      setRjHint(cadastro.emRecuperacaoJudicial);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao consultar CNPJ.");
    } finally {
      setLoading(false);
    }
  }

  // `destino` é a aba que o usuário quer abrir depois de salvar — "dados"
  // quando ele só clicou em "Salvar registro".
  async function salvar(destino: Aba) {
    if (saving) return;
    if (!fields.razaoSocial.trim()) {
      setSaveError("Preencha a razão social (ou busque pelo CNPJ).");
      setAbaBloqueada(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await createLeadAction({
      razaoSocial: fields.razaoSocial,
      emRecuperacaoJudicial: rjHint,
      cnpj: vazioParaUndefined(fields.cnpj),
      cnaePrincipal: vazioParaUndefined(fields.cnaePrincipal),
      cnaeDescricao: vazioParaUndefined(fields.cnaeDescricao),
      porte: vazioParaUndefined(fields.porte),
      uf: vazioParaUndefined(fields.uf),
      municipio: vazioParaUndefined(fields.municipio),
      situacao: vazioParaUndefined(fields.situacao),
    });
    if (!res.ok) {
      setSaving(false);
      setSaveError(res.message);
      setAbaBloqueada(null);
      return;
    }
    sessionStorage.setItem(TOAST_SESSION_KEY, "Empresa adicionada à triagem");
    setAbaBloqueada(null);
    const fichaSalva = `/dashboard/leads/${res.data.id}?aba=${destino}`;

    // Fora do drawer (acesso direto a /dashboard/leads/novo) é página
    // cheia mesmo — não há slot pra colapsar.
    if (variant === "page") {
      // replace (não push): "voltar" leva pra lista de Prospecção, não pro
      // cadastro em branco que acabou de virar registro de verdade.
      router.replace(fichaSalva);
      return;
    }

    // Dentro do drawer, ir DIRETO do cadastro pra ficha salva abria a
    // versão página cheia em produção (bug de 2026-09-15): navegar de uma
    // rota já interceptada pra outra do mesmo slot não é interceptado
    // lá. Então fecha o cadastro primeiro (router.back() é o único jeito
    // de colapsar o slot) e só depois abre a ficha — a partir da lista,
    // que é exatamente a navegação que o CRM já faz ao clicar numa
    // empresa, e essa sempre vira drawer.
    let abriu = false;
    const abrirFicha = () => {
      if (abriu) return;
      abriu = true;
      router.push(fichaSalva);
    };
    window.addEventListener("popstate", () => setTimeout(abrirFicha, 0), { once: true });
    // Rede de segurança: se não houver pra onde voltar, o popstate nunca
    // vem e o usuário ficaria preso no cadastro já salvo.
    setTimeout(abrirFicha, 800);
    router.back();
  }

  const abas = (
    <>
      {ABAS.map((a) => {
        const ativa = a.id === "dados";
        return (
          <button
            key={a.id}
            type="button"
            className={ativa ? "drawer-tab active" : "drawer-tab"}
            onClick={() => {
              if (ativa) return;
              setAbaBloqueada(a.id);
            }}
          >
            {a.label}
            {!ativa && <span className="tab-count">🔒</span>}
          </button>
        );
      })}
    </>
  );

  const botaoSalvar = (
    <button
      type="submit"
      form={FORM_ID}
      className="btn btn-primary btn-sm"
      style={{ width: 170, justifyContent: "center" }}
      disabled={saving}
    >
      {saving ? "Salvando…" : "✓ Salvar registro"}
    </button>
  );

  const corpo = (
    <>
      <div className="lembrete-salvar">
        Preencha o CNPJ e salve o registro antes de cadastrar contatos, tarefas ou anotações — só
        depois de salvo o histórico tem onde ficar guardado.
      </div>

      <div className="row-form" style={{ marginBottom: 6 }}>
        <input
          placeholder="Buscar por CNPJ (14 dígitos)"
          style={{ minWidth: 260 }}
          value={cnpjQuery}
          onChange={(e) => setCnpjQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void buscarCnpj();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void buscarCnpj()}
          disabled={loading}
        >
          {loading ? "Consultando…" : "Consultar Receita"}
        </button>
      </div>
      <p className="t-sub" style={{ marginBottom: 14 }}>
        Puxa razão social, CNAE, porte, situação cadastral e cidade da Receita Federal (BrasilAPI) —
        os demais campos continuam editáveis antes de salvar.
      </p>

      {lookupError && <div className="error-banner">{lookupError}</div>}
      {saveError && <div className="error-banner">{saveError}</div>}
      {rjHint && (
        <div className="error-banner">
          ⚠ Esta empresa está em recuperação judicial na Receita Federal — o aviso foi retirado da
          razão social e vira um indicador próprio ao salvar.
        </div>
      )}

      <form
        id={FORM_ID}
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar("dados");
        }}
      >
        <label>
          Razão social*
          <input name="razaoSocial" required maxLength={255} {...field("razaoSocial")} />
        </label>
        <label>
          CNPJ
          <input name="cnpj" maxLength={20} {...field("cnpj")} />
        </label>
        <label>
          CNAE principal
          <input name="cnaePrincipal" placeholder="2511-0" maxLength={10} {...field("cnaePrincipal")} />
        </label>
        <label>
          Descrição do CNAE
          <input name="cnaeDescricao" maxLength={255} {...field("cnaeDescricao")} />
        </label>
        <label>
          Porte
          <select name="porte" {...field("porte")}>
            <option value="">—</option>
            {PORTES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Situação cadastral
          <select name="situacao" {...field("situacao")}>
            {SITUACOES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          UF
          <input name="uf" maxLength={2} placeholder="RS" {...field("uf")} />
        </label>
        <label>
          Município
          <input name="municipio" maxLength={255} {...field("municipio")} />
        </label>
      </form>

      <div style={{ marginTop: 18 }}>
        <button
          type="submit"
          form={FORM_ID}
          className="btn btn-primary"
          disabled={saving}
        >
          {saving ? "Salvando…" : "✓ Salvar registro"}
        </button>
      </div>
    </>
  );

  // Aviso de aba travada — modal próprio (não o OverlayModal de rota
  // interceptada, que fecha com router.back() e derrubaria o cadastro).
  const avisoAbaTravada = abaBloqueada && (
    <div className="overlay open" onClick={() => setAbaBloqueada(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Salve o registro primeiro</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAbaBloqueada(null)}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            A aba <strong>{ABAS.find((a) => a.id === abaBloqueada)?.label}</strong> só abre depois
            que a empresa estiver salva na triagem — contato, tarefa e anotação precisam de um
            registro já criado para ficarem vinculados a ele.
          </p>
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setAbaBloqueada(null)}
            disabled={saving}
          >
            Continuar preenchendo
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void salvar(abaBloqueada)}
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar e abrir a aba"}
          </button>
        </div>
      </div>
    </div>
  );

  const cnpjMeta = formatCnpj(fields.cnpj) || "sem CNPJ";
  const localMeta = fields.municipio ? ` · ${fields.municipio}${fields.uf ? `/${fields.uf}` : ""}` : "";

  if (variant === "page") {
    return (
      <>
        <div className="topbar">
          <div>
            <div className="page-title">{fields.razaoSocial || "Nova empresa"}</div>
            <div className="page-sub">
              {cnpjMeta}
              {localMeta}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {botaoSalvar}
            <Link href="/dashboard/leads" className="btn btn-ghost btn-sm">
              ✕ Cancelar
            </Link>
          </div>
        </div>

        <div className="drawer-tabs" style={{ padding: "0 28px" }}>
          {abas}
        </div>

        <div className="content">{corpo}</div>
        {avisoAbaTravada}
      </>
    );
  }

  return (
    <>
      <OverlayDrawer
        head={
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-co-name">{fields.razaoSocial || "Nova empresa"}</div>
            <div className="drawer-co-meta">
              {cnpjMeta}
              {localMeta}
            </div>
            <div className="row-form" style={{ marginTop: 10 }}>
              <span className="pill pill-blue">Prospecção· triagem</span>
              <span className="pill pill-gray">não salvo</span>
              <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>{botaoSalvar}</div>
            </div>
          </div>
        }
        tabs={abas}
      >
        {corpo}
      </OverlayDrawer>
      {avisoAbaTravada}
    </>
  );
}
