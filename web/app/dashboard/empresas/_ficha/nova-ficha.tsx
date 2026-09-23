"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OverlayDrawer from "@/app/dashboard/_overlay/overlay-drawer";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { CnpjLookupResult } from "@/lib/api/companies";
import type { PessoaTipo } from "@/lib/api/types";
import { criarEmpresaAction } from "../actions";
import ContatosInline from "./contatos-inline";
import { ABAS, type Aba } from "./ficha-tabs";

// Cadastro de empresa nova em Cadastros (2026-09-15, pedido do usuário:
// "está horrível o cadastro de nova empresa. Faça os mesmos ajustes que
// implementamos em Prospecção"). O modal com 20 campos empilhados foi
// apagado; o cadastro acontece na própria ficha da empresa — mesma
// moldura de empresas/[id] (cabeçalho + abas + corpo), já aberta em
// "Dados cadastrais", com os campos em blocos (identificação, contato,
// endereço) em vez de um bolo só.
//
// Saíram do cadastro os campos que não aparecem em lugar nenhum da ficha
// nem da lista (nome pra contato, domínio, setor, porte, data de
// nascimento, data de cadastro) — quem precisar preencher um deles num
// registro vindo do eGestor continua tendo o "Editar" da ficha.
//
// As outras abas dependem de um registro existente, então ficam travadas
// até salvar: clicar nelas abre um aviso oferecendo salvar na hora e
// abrir a aba em seguida.
//
// Três molduras:
// - "drawer": rota interceptada @drawer/(.)empresas/nova (o caminho
//   normal, a partir da lista de Empresas). Depois de salvar vira a ficha
//   de verdade, ainda como drawer;
// - "page": acesso direto/refresh em /dashboard/empresas/nova;
// - "modal": cadastro chamado de DENTRO de outro formulário — o card de
//   Nova oportunidade, pelo seletor de empresa (pipeline/company-picker).
//   Aqui não há navegação nenhuma: o modal sai por portal pra fora do
//   <form> que o chamou, devolve a empresa criada por callback e, depois
//   de salvar, deixa cadastrar os contatos ali mesmo. Fechar volta pro
//   formulário de origem com a empresa já escolhida.

const FORM_ID = "nova-empresa-form";
const ABA_ATIVA: Aba = "cadastro";

// Vendas/ABC/Serviços nem aparecem: saem do histórico do eGestor, que não
// existe pra uma empresa que está sendo criada agora (e ainda dependem de
// permissão própria).
const ABAS_DO_CADASTRO = ABAS.filter((a) => !a.permissao);

type Fields = {
  razaoSocial: string;
  fantasia: string;
  cpfCnpj: string;
  tipo: "" | PessoaTipo;
  emails: string;
  fones: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  tags: string;
};

const EMPTY_FIELDS: Fields = {
  razaoSocial: "",
  fantasia: "",
  cpfCnpj: "",
  tipo: "",
  emails: "",
  fones: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  tags: "",
};

function vazioParaUndefined(value: string): string | undefined {
  const str = value.trim();
  return str === "" ? undefined : str;
}

function lista(value: string): string[] | undefined {
  const itens = value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
  return itens.length > 0 ? itens : undefined;
}

export default function NovaEmpresaFicha({
  variant,
  termoInicial,
  onCadastrada,
  onFechar,
}: {
  variant: "drawer" | "page" | "modal";
  // O que o usuário já tinha digitado na busca de empresa do formulário de
  // origem: CNPJ completo vira consulta automática à Receita; qualquer
  // outra coisa entra como razão social pra ele completar.
  termoInicial?: string;
  onCadastrada?: (empresa: { id: string; nome: string }) => void;
  onFechar?: () => void;
}) {
  const router = useRouter();
  const termo = (termoInicial ?? "").trim();
  const cnpjDoTermo = termo.replace(/\D/g, "").length === 14 ? termo.replace(/\D/g, "") : "";
  const [fields, setFields] = useState<Fields>(() =>
    cnpjDoTermo || !termo ? EMPTY_FIELDS : { ...EMPTY_FIELDS, razaoSocial: termo },
  );
  const [cnpjQuery, setCnpjQuery] = useState(cnpjDoTermo);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [abaBloqueada, setAbaBloqueada] = useState<Aba | null>(null);
  // Empresa já criada (só na variante "modal", que não navega pra ficha):
  // troca o formulário pelo painel de contatos.
  const [empresaSalva, setEmpresaSalva] = useState<{ id: string; nome: string } | null>(null);
  // Retorno cru da Receita: vai junto no salvamento pra ficha já nascer
  // com o cartão CNPJ preenchido (customFields.cnpj_lookup, o mesmo que o
  // botão "Buscar dados" da ficha grava). Sem isto, a aba "Dados
  // cadastrais" da empresa recém-criada pediria pra consultar de novo o
  // CNPJ que acabou de ser consultado aqui.
  const [lookup, setLookup] = useState<CnpjLookupResult | null>(null);
  // O portal da variante "modal" só existe no navegador: renderizar no
  // servidor (ou no primeiro render, antes de hidratar) deixa o HTML do
  // servidor diferente do da tela e o React descarta a hidratação inteira.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  // Esc com o aviso aberto fecha só o aviso — sem o listener em fase de
  // captura, o do OverlayDrawer fecharia o drawer inteiro e levaria junto
  // o cadastro digitado.
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

  // Mesma ideia na variante "modal": o Esc não pode vazar pro modal de
  // trás (o card de oportunidade fecha com router.back() no Esc). Com o
  // aviso de aba travada aberto, quem trata o Esc é o listener acima —
  // os dois ficam no mesmo nó, então stopPropagation não segura este.
  useEffect(() => {
    if (variant !== "modal" || abaBloqueada) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onFechar?.();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [variant, onFechar, abaBloqueada]);

  // CNPJ completo já digitado na busca do formulário de origem: consulta a
  // Receita assim que abre, que é o que o usuário pediu ao clicar em
  // "cadastrar".
  useEffect(() => {
    if (!cnpjDoTermo) return;
    void buscarCnpj();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const field = (name: keyof Fields) => ({
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      // Mexeu na razão social depois da busca: o texto que vai ser salvo
      // não é mais garantidamente o que a Receita devolveu, então o
      // snapshot deixa de valer como retrato do cadastro.
      if (name === "razaoSocial") setLookup(null);
      setFields((prev) => ({ ...prev, [name]: e.target.value }));
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
      setFields((prev) => ({
        ...prev,
        razaoSocial: data.razaoSocial ?? prev.razaoSocial,
        fantasia: data.fantasia ?? prev.fantasia,
        cpfCnpj: data.cpfCnpj,
        tipo: "PJ",
        emails: data.emails.join(", ") || prev.emails,
        fones: data.fones.join(", ") || prev.fones,
        cep: data.cep ?? prev.cep,
        logradouro: data.logradouro ?? prev.logradouro,
        numero: data.numero ?? prev.numero,
        complemento: data.complemento ?? prev.complemento,
        bairro: data.bairro ?? prev.bairro,
        cidade: data.cidade ?? prev.cidade,
        uf: data.uf ?? prev.uf,
      }));
      setLookup(data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao consultar CNPJ.");
    } finally {
      setLoading(false);
    }
  }

  const nome = fields.razaoSocial.trim() || fields.fantasia.trim() || "Nova empresa";

  // `destino` é a aba que o usuário quer abrir depois de salvar —
  // "cadastro" quando ele só clicou em "Salvar registro".
  async function salvar(destino: Aba) {
    if (saving) return;
    if (!fields.razaoSocial.trim() && !fields.fantasia.trim()) {
      setSaveError("Preencha razão social ou fantasia (ou busque pelo CNPJ).");
      setAbaBloqueada(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await criarEmpresaAction({
      razaoSocial: vazioParaUndefined(fields.razaoSocial),
      fantasia: vazioParaUndefined(fields.fantasia),
      emRecuperacaoJudicial: lookup?.emRecuperacaoJudicial,
      cpfCnpj: vazioParaUndefined(fields.cpfCnpj),
      tipo: fields.tipo === "" ? undefined : fields.tipo,
      emails: lista(fields.emails),
      fones: lista(fields.fones),
      cep: vazioParaUndefined(fields.cep),
      logradouro: vazioParaUndefined(fields.logradouro),
      numero: vazioParaUndefined(fields.numero),
      complemento: vazioParaUndefined(fields.complemento),
      bairro: vazioParaUndefined(fields.bairro),
      cidade: vazioParaUndefined(fields.cidade),
      uf: vazioParaUndefined(fields.uf),
      tags: lista(fields.tags),
      cnpjLookup: lookup ?? undefined,
    });
    if (!res.ok) {
      setSaving(false);
      setSaveError(res.message);
      setAbaBloqueada(null);
      return;
    }

    // Chamado de dentro de outro formulário: nada de navegar (levaria
    // junto o que já estava preenchido lá). Devolve a empresa na hora —
    // assim, mesmo fechando no ✕, o formulário de origem já fica com ela
    // escolhida — e segue pro painel de contatos.
    if (variant === "modal") {
      const salva = { id: res.data.id, nome };
      setSaving(false);
      setAbaBloqueada(null);
      setEmpresaSalva(salva);
      onCadastrada?.(salva);
      window.dispatchEvent(new CustomEvent("crm:toast", { detail: "Empresa cadastrada" }));
      return;
    }

    sessionStorage.setItem(TOAST_SESSION_KEY, "Empresa cadastrada");
    setAbaBloqueada(null);
    const fichaSalva = `/dashboard/empresas/${res.data.id}?aba=${destino}`;

    // Fora do drawer (acesso direto a /dashboard/empresas/nova) é página
    // cheia mesmo — não há slot pra colapsar.
    if (variant === "page") {
      router.replace(fichaSalva);
      return;
    }

    // Mesmo mecanismo do cadastro da Prospecção (leads/_ficha/nova-ficha.tsx):
    // ir DIRETO do cadastro pra ficha salva abria a versão página cheia em
    // produção. Fecha o cadastro primeiro (router.back() é o único jeito de
    // colapsar o slot) e só depois abre a ficha — a partir da lista, que é
    // a navegação que o CRM já faz ao clicar numa empresa.
    let abriu = false;
    const abrirFicha = () => {
      if (abriu) return;
      abriu = true;
      router.push(fichaSalva);
    };
    window.addEventListener("popstate", () => setTimeout(abrirFicha, 0), { once: true });
    // Rede de segurança: sem histórico pra voltar, o popstate nunca vem e
    // o usuário ficaria preso no cadastro já salvo.
    setTimeout(abrirFicha, 800);
    router.back();
  }

  const abas = (
    <>
      {ABAS_DO_CADASTRO.map((a) => {
        const ativa = a.id === ABA_ATIVA;
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
      // Na variante "modal" não existe <form> (ver camposDoCadastro): o
      // clique salva direto.
      type={variant === "modal" ? "button" : "submit"}
      form={variant === "modal" ? undefined : FORM_ID}
      onClick={variant === "modal" ? () => void salvar(ABA_ATIVA) : undefined}
      className="btn btn-primary btn-sm"
      style={{ width: 170, justifyContent: "center" }}
      disabled={saving}
    >
      {saving ? "Salvando…" : "✓ Salvar registro"}
    </button>
  );

  const camposDoCadastro = (
    <>
      <div className="drawer-section-title">Identificação</div>
      <div className="form-grid">
        <label>
          Razão social
          <input name="razaoSocial" maxLength={255} {...field("razaoSocial")} />
        </label>
        <label>
          Fantasia
          <input name="fantasia" maxLength={255} {...field("fantasia")} />
        </label>
        <label>
          CPF/CNPJ
          <input name="cpfCnpj" maxLength={20} {...field("cpfCnpj")} />
        </label>
        <label>
          Tipo
          <select name="tipo" {...field("tipo")}>
            <option value="">—</option>
            <option value="PJ">Pessoa jurídica</option>
            <option value="PF">Pessoa física</option>
          </select>
        </label>
      </div>
      <p className="t-sub" style={{ marginTop: 6 }}>
        Preencha ao menos um dos dois nomes — é o que identifica a empresa nas listas e nos cards.
      </p>

      <div className="drawer-section-title" style={{ marginTop: 20 }}>
        Contato
      </div>
      <div className="form-grid">
        <label>
          E-mails
          <input
            name="emails"
            placeholder="comercial@empresa.com.br, financeiro@empresa.com.br"
            {...field("emails")}
          />
        </label>
        <label>
          Telefones
          <input name="fones" placeholder="(51) 3333-4444, (51) 99999-8888" {...field("fones")} />
        </label>
      </div>
      <p className="t-sub" style={{ marginTop: 6 }}>
        Mais de um: separe por vírgula. Pessoa de contato com nome e cargo entra depois, na aba
        Contatos da ficha.
      </p>

      <div className="drawer-section-title" style={{ marginTop: 20 }}>
        Endereço
      </div>
      <div className="form-grid">
        <label>
          CEP
          <input name="cep" maxLength={9} {...field("cep")} />
        </label>
        <label>
          Logradouro
          <input name="logradouro" maxLength={255} {...field("logradouro")} />
        </label>
        <label>
          Número
          <input name="numero" maxLength={20} {...field("numero")} />
        </label>
        <label>
          Complemento
          <input name="complemento" maxLength={255} {...field("complemento")} />
        </label>
        <label>
          Bairro
          <input name="bairro" maxLength={255} {...field("bairro")} />
        </label>
        <label>
          Cidade
          <input name="cidade" maxLength={255} {...field("cidade")} />
        </label>
        <label>
          UF
          <input name="uf" maxLength={2} placeholder="RS" {...field("uf")} />
        </label>
      </div>

      <div className="drawer-section-title" style={{ marginTop: 20 }}>
        Classificação
      </div>
      <div className="form-grid">
        <label>
          Tags
          <input name="tags" placeholder="cliente, revenda" {...field("tags")} />
        </label>
      </div>
      <p className="t-sub" style={{ marginTop: 6 }}>
        Separadas por vírgula. A tag <strong>cliente</strong> é o que faz a empresa aparecer como
        cliente (e não como lead) nas listas.
      </p>
    </>
  );

  const corpo = (
    <>
      <div className="lembrete-salvar">
        {variant === "modal"
          ? "Salve o cadastro e a empresa já entra na oportunidade — depois de salvar você ainda pode incluir os contatos dela aqui mesmo, antes de voltar."
          : "Preencha o CNPJ e salve o registro antes de cadastrar contatos, tarefas ou anotações — só depois de salvo o histórico tem onde ficar guardado."}
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
        Puxa razão social, fantasia, endereço, telefone e e-mail da Receita Federal (BrasilAPI) — os
        campos continuam editáveis antes de salvar. A Inscrição Estadual é dado da SEFAZ e entra
        depois, na aba &ldquo;Dados cadastrais&rdquo; da ficha.
      </p>

      {lookupError && <div className="error-banner">{lookupError}</div>}
      {saveError && <div className="error-banner">{saveError}</div>}
      {lookup?.emRecuperacaoJudicial && (
        <div className="error-banner">
          ⚠ Esta empresa está em recuperação judicial na Receita Federal — o aviso foi retirado da
          razão social e vira um indicador próprio ao salvar.
        </div>
      )}

      {/* Na variante "modal" os campos NÃO podem vir dentro de um <form>:
          o cadastro é chamado de dentro do formulário da oportunidade, e
          formulário dentro de formulário não existe em HTML. O portal já
          tira este bloco de lá (ver o render da variante) e o salvamento
          sai por onClick no rodapé. */}
      {variant === "modal" ? (
        camposDoCadastro
      ) : (
        <form
          id={FORM_ID}
          onSubmit={(e) => {
            e.preventDefault();
            void salvar(ABA_ATIVA);
          }}
        >
          {camposDoCadastro}
        </form>
      )}

      {variant !== "modal" && (
        <div style={{ marginTop: 22 }}>
          <button type="submit" form={FORM_ID} className="btn btn-primary" disabled={saving}>
            {saving ? "Salvando…" : "✓ Salvar registro"}
          </button>
        </div>
      )}
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
            A aba <strong>{ABAS_DO_CADASTRO.find((a) => a.id === abaBloqueada)?.label}</strong> só
            abre depois que a empresa estiver salva — contato, tarefa, anotação e oportunidade
            precisam de um registro já criado para ficarem vinculados a ele.
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

  const docMeta = fields.cpfCnpj.trim() || "sem CPF/CNPJ";
  const localMeta = fields.cidade ? ` · ${fields.cidade}${fields.uf ? `/${fields.uf}` : ""}` : "";

  if (variant === "modal") {
    if (!montado || typeof document === "undefined") return null;

    const painelPosSalvar = empresaSalva && (
      <>
        <div className="lembrete-salvar">
          ✓ <strong>{empresaSalva.nome}</strong> cadastrada e já vinculada à oportunidade. Aproveite
          para incluir os contatos dela — ao concluir, você volta pro cadastro da oportunidade.
        </div>
        <div className="drawer-section-title">Contatos</div>
        <ContatosInline companyId={empresaSalva.id} />
        <p className="t-sub" style={{ marginTop: 14 }}>
          Tarefas, anotações e o restante do histórico ficam na ficha da empresa, em Comercial ›
          Carteira de clientes.
        </p>
      </>
    );

    // Mesma gaveta lateral do cadastro em Empresas (pedido do usuário,
    // 2026-09-15: "pedi pra abrir o mesmo modal de nova empresa") —
    // cabeçalho com nome e Salvar, abas travadas até salvar, corpo em
    // blocos. Não usa o OverlayDrawer porque ele fecha com router.back(),
    // que derrubaria a oportunidade sendo cadastrada atrás; aqui fechar é
    // só onFechar. Camadas acima do modal da oportunidade (z-index 100).
    return createPortal(
      <>
        <div className="drawer-overlay open" style={{ zIndex: 110 }} onClick={() => onFechar?.()} />
        <div className="drawer open" style={{ zIndex: 115 }}>
          <div className="drawer-head">
            <div className="drawer-head-top">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-co-name">{empresaSalva ? empresaSalva.nome : nome}</div>
                <div className="drawer-co-meta">
                  {docMeta}
                  {localMeta}
                </div>
                <div className="row-form" style={{ marginTop: 10 }}>
                  {empresaSalva ? (
                    <span className="pill pill-green">salva · vinculada à oportunidade</span>
                  ) : (
                    <span className="pill pill-gray">não salvo</span>
                  )}
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    {empresaSalva ? (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => onFechar?.()}>
                        Concluir e voltar pra oportunidade
                      </button>
                    ) : (
                      botaoSalvar
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onFechar?.()}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
          </div>
          {!empresaSalva && <div className="drawer-tabs">{abas}</div>}
          <div className="drawer-body">{empresaSalva ? painelPosSalvar : corpo}</div>
        </div>
        {abaBloqueada && <div style={{ position: "relative", zIndex: 120 }}>{avisoAbaTravada}</div>}
      </>,
      document.body,
    );
  }

  if (variant === "page") {
    return (
      <>
        <div className="topbar">
          <div>
            <div className="page-title">{nome}</div>
            <div className="page-sub">
              {docMeta}
              {localMeta}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {botaoSalvar}
            <Link href="/dashboard/empresas" className="btn btn-ghost btn-sm">
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
            <div className="drawer-co-name">{nome}</div>
            <div className="drawer-co-meta">
              {docMeta}
              {localMeta}
            </div>
            <div className="row-form" style={{ marginTop: 10 }}>
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
