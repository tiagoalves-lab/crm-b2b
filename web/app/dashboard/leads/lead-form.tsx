"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { CnpjLookupResult } from "@/lib/api/companies";
import { createRawLeadAction } from "./actions";
import SubmitButton from "@/app/_components/submit-button";

const PORTES = ["GRANDE", "MÉDIO", "PEQUENO"];
const SITUACOES = ["ATIVA", "BAIXADA", "SUSPENSA", "INAPTA", "NULA"];
const FONTES = [
  { value: "manual", label: "Manual" },
  { value: "econodata", label: "Econodata" },
  { value: "apify", label: "Apify" },
  { value: "comexstat", label: "Comex Stat" },
];

type Fields = {
  razaoSocial: string;
  cnpj: string;
  cnaePrincipal: string;
  cnaeDescricao: string;
  porte: string;
  situacao: string;
  uf: string;
  municipio: string;
  fonte: string;
};

// Campos de texto livre do cadastro que a "Nova empresa" da Prospecção
// converte pra caixa alta ao digitar (pedido do usuário, 2026-08-10) —
// mesmo escopo do RawLeadService#upperCaseTextFields no backend. Fora:
// cnpj (dígito, não texto de cadastro) e os <select> (porte/situação/
// origem), que já só têm opções fixas em maiúsculo.
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
  fonte: "manual",
};

// lookupCnpj (company.service.ts) devolve o CNAE já como "código -
// descrição" numa string só (mesmo texto do card da Receita na ficha de
// empresa) — aqui precisa separar em dois campos porque RawLead guarda
// cnaePrincipal/cnaeDescricao à parte.
function splitCnae(combined?: string): { codigo: string; descricao: string } {
  if (!combined) return { codigo: "", descricao: "" };
  const idx = combined.indexOf(" - ");
  if (idx === -1) return { codigo: combined, descricao: "" };
  return { codigo: combined.slice(0, idx), descricao: combined.slice(idx + 3) };
}

// Espelha o normalizePorte do backend (spreadsheet-import.util.ts) — a
// Receita devolve texto livre ("DEMAIS", "MICRO EMPRESA", "EMPRESA DE
// PEQUENO PORTE"), e o <select> aqui só tem as 3 faixas que o
// LeadScoringService reconhece.
function normalizePorte(raw?: string): string {
  const upper = (raw ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  if (!upper) return "";
  if (upper === "EPP" || upper.includes("PEQUENO") || upper.includes("MICRO")) return "PEQUENO";
  if (upper === "DEMAIS") return "MÉDIO";
  if (upper === "GRANDE") return "GRANDE";
  if (upper === "MEDIO") return "MÉDIO";
  return "";
}

function normalizeSituacao(raw?: string): string {
  const upper = (raw ?? "").trim().toUpperCase();
  return SITUACOES.includes(upper) ? upper : "ATIVA";
}

// Form de "Novo lead" — mesma busca por CNPJ (BrasilAPI via /api/cnpj) já
// usada em CompanyForm (Empresas), só que aqui autopreenche os campos do
// lead bruto em vez de criar a empresa direto: o registro nasce como
// RawLead na triagem, caminho normal de sempre (aprovar depois vira
// empresa). Reusado tanto pela rota cheia (novo/page.tsx) quanto pelo
// modal interceptado (@modal/(.)leads/novo/page.tsx).
export default function LeadForm() {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [importador, setImportador] = useState(false);
  const [cnpjQuery, setCnpjQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  // Hint pro backend não redetectar "EM RECUPERAÇÃO JUDICIAL" a partir de
  // um razaoSocial que a busca por CNPJ já devolve limpo (ver
  // CnpjLookupResult#emRecuperacaoJudicial) — undefined quando o usuário
  // nunca buscou por CNPJ ou editou a razão social manualmente depois
  // (nesse caso o backend autodetecta a partir do texto final mesmo).
  const [rjHint, setRjHint] = useState<boolean | undefined>(undefined);

  const [state, formAction] = useActionState(createRawLeadAction, null);
  useEffect(() => {
    if (state?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, "Lead adicionado à triagem");
      router.back();
    }
  }, [state, router]);

  const field = (name: keyof Fields) => ({
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      // Editar a razão social manualmente depois da busca por CNPJ invalida
      // o hint (o texto que será submetido não é mais garantidamente o que
      // a Receita devolveu) — o backend volta a autodetectar a partir do
      // texto final.
      if (name === "razaoSocial") setRjHint(undefined);
      // Padroniza em caixa alta os campos de texto do cadastro (pedido do
      // usuário, 2026-08-10) — o textbox já mostra maiúsculo enquanto
      // digita, então o que é submetido já sai nessa condição (o backend
      // também normaliza, ver RawLeadService#upperCaseTextFields, mas o
      // pedido aqui era o campo virar visualmente maiúsculo na digitação).
      // CNPJ fica de fora (é dígito, não texto de cadastro); os campos
      // <select> (porte/situação/origem) já só têm opções fixas em maiúsculo.
      const value = UPPERCASE_FIELDS.has(name) ? e.target.value.toUpperCase() : e.target.value;
      setFields((prev) => ({ ...prev, [name]: value }));
    },
  });

  async function handleLookup() {
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
      const cnae = splitCnae(data.cnaePrincipal);
      setFields((prev) => ({
        ...prev,
        // Mesma padronização em caixa alta do field() acima — a Receita
        // devolve razão social/município em texto misto, então força pra
        // já entrar no cadastro na condição padrão.
        razaoSocial: (data.razaoSocial ?? prev.razaoSocial).toUpperCase(),
        cnpj: data.cpfCnpj ?? prev.cnpj,
        cnaePrincipal: (cnae.codigo || prev.cnaePrincipal).toUpperCase(),
        cnaeDescricao: (cnae.descricao || prev.cnaeDescricao).toUpperCase(),
        porte: normalizePorte(data.porte) || prev.porte,
        situacao: normalizeSituacao(data.situacaoCadastral),
        uf: (data.uf ?? prev.uf).toUpperCase(),
        municipio: (data.cidade ?? prev.municipio).toUpperCase(),
      }));
      setRjHint(data.emRecuperacaoJudicial);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao consultar CNPJ.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="row-form" style={{ marginBottom: 12 }}>
        <input
          placeholder="Buscar por CNPJ (14 dígitos)"
          value={cnpjQuery}
          onChange={(e) => setCnpjQuery(e.target.value)}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleLookup()} disabled={loading}>
          {loading ? "Buscando…" : "Buscar dados"}
        </button>
      </div>
      {lookupError && <div className="error-banner">{lookupError}</div>}
      {state?.ok === false && <div className="error-banner">{state.message}</div>}
      {rjHint && (
        <div className="error-banner">
          ⚠ Esta empresa está em recuperação judicial na Receita Federal — o aviso foi retirado
          da razão social e vira um indicador próprio ao salvar.
        </div>
      )}
      <p className="field-hint" style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: -4, marginBottom: 12 }}>
        Puxa razão social, CNAE, porte e situação cadastral da Receita Federal (BrasilAPI) — os
        demais campos continuam editáveis antes de adicionar à triagem.
      </p>

      <form action={formAction} className="form-grid">
        <input type="hidden" name="emRecuperacaoJudicial" value={rjHint === undefined ? "" : String(rjHint)} />
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
        <label>
          Origem
          <select name="fonte" {...field("fonte")}>
            {FONTES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="row-form" style={{ alignItems: "center" }}>
          <input
            type="checkbox"
            name="importador"
            style={{ width: "auto" }}
            checked={importador}
            onChange={(e) => setImportador(e.target.checked)}
          />
          Importador (Comex Stat)
        </label>
        <SubmitButton className="btn btn-primary" pendingLabel="Adicionando…">
          Adicionar à triagem
        </SubmitButton>
      </form>
    </div>
  );
}
