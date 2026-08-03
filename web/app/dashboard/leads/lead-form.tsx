"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { CnpjLookupResult } from "@/lib/api/companies";
import { createRawLeadAction } from "./actions";

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

  const [state, formAction] = useActionState(createRawLeadAction, null);
  useEffect(() => {
    if (state?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, "Lead adicionado à triagem");
      router.back();
    }
  }, [state, router]);

  const field = (name: keyof Fields) => ({
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((prev) => ({ ...prev, [name]: e.target.value })),
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
        razaoSocial: data.razaoSocial ?? prev.razaoSocial,
        cnpj: data.cpfCnpj ?? prev.cnpj,
        cnaePrincipal: cnae.codigo || prev.cnaePrincipal,
        cnaeDescricao: cnae.descricao || prev.cnaeDescricao,
        porte: normalizePorte(data.porte) || prev.porte,
        situacao: normalizeSituacao(data.situacaoCadastral),
        uf: data.uf ?? prev.uf,
        municipio: data.cidade ?? prev.municipio,
      }));
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
      <p className="field-hint" style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: -4, marginBottom: 12 }}>
        Puxa razão social, CNAE, porte e situação cadastral da Receita Federal (BrasilAPI) — os
        demais campos continuam editáveis antes de adicionar à triagem.
      </p>

      <form action={formAction} className="form-grid">
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
        <button type="submit" className="btn btn-primary">
          Adicionar à triagem
        </button>
      </form>
    </div>
  );
}
