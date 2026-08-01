"use client";

import { useState } from "react";
import type { CnpjLookupResult } from "@/lib/api/companies";
import type { Company } from "@/lib/api/types";
import { createCompanyAction, updateCompanyAction } from "./actions";

type Fields = {
  razaoSocial: string;
  fantasia: string;
  cpfCnpj: string;
  tipo: "" | "PF" | "PJ";
  emails: string;
  fones: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  cidade: string;
  uf: string;
};

const EMPTY_FIELDS: Fields = {
  razaoSocial: "",
  fantasia: "",
  cpfCnpj: "",
  tipo: "",
  emails: "",
  fones: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cep: "",
  cidade: "",
  uf: "",
};

function fieldsFrom(company?: Company): Fields {
  if (!company) return EMPTY_FIELDS;
  return {
    razaoSocial: company.razaoSocial ?? "",
    fantasia: company.fantasia ?? "",
    cpfCnpj: company.cpfCnpj ?? "",
    tipo: company.tipo ?? "",
    emails: company.emails.join(", "),
    fones: company.fones.join(", "),
    logradouro: company.logradouro ?? "",
    numero: company.numero ?? "",
    complemento: company.complemento ?? "",
    bairro: company.bairro ?? "",
    cep: company.cep ?? "",
    cidade: company.cidade ?? "",
    uf: company.uf ?? "",
  };
}

// Usado tanto pra cadastrar (sem `company`) quanto pra editar (aba "Dados
// cadastrais" da ficha, com `company` preenchido) — mesmos campos, só
// muda o valor inicial e a Server Action de destino.
export default function CompanyForm({
  company,
  backHref,
}: {
  company?: Company;
  backHref?: string;
}) {
  const [fields, setFields] = useState<Fields>(() => fieldsFrom(company));
  const [cnpjQuery, setCnpjQuery] = useState(company?.cpfCnpj ?? "");
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

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
      setFields((prev) => ({
        ...prev,
        razaoSocial: data.razaoSocial ?? prev.razaoSocial,
        fantasia: data.fantasia ?? prev.fantasia,
        cpfCnpj: data.cpfCnpj,
        tipo: "PJ",
        emails: data.emails.join(", "),
        fones: data.fones.join(", "),
        logradouro: data.logradouro ?? prev.logradouro,
        numero: data.numero ?? prev.numero,
        complemento: data.complemento ?? prev.complemento,
        bairro: data.bairro ?? prev.bairro,
        cep: data.cep ?? prev.cep,
        cidade: data.cidade ?? prev.cidade,
        uf: data.uf ?? prev.uf,
      }));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao consultar CNPJ.");
    } finally {
      setLoading(false);
    }
  }

  const action = company ? updateCompanyAction : createCompanyAction;

  return (
    <div>
      <div className="row-form" style={{ marginBottom: 12 }}>
        <input
          placeholder="Buscar por CNPJ (14 dígitos)"
          value={cnpjQuery}
          onChange={(e) => setCnpjQuery(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleLookup}
          disabled={loading}
        >
          {loading ? "Buscando…" : "Buscar dados"}
        </button>
      </div>
      {lookupError && <div className="error-banner">{lookupError}</div>}
      <p className="field-hint" style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: -4, marginBottom: 12 }}>
        Puxa razão social, endereço e situação da Receita Federal (BrasilAPI). A Inscrição
        Estadual é dado da SEFAZ e entra à parte, na seção &ldquo;Dados fiscais estaduais&rdquo; abaixo.
      </p>

      <form action={action} className="form-grid">
        {company && <input type="hidden" name="id" value={company.id} />}
        {backHref && <input type="hidden" name="back" value={backHref} />}
        <label>
          Nome*
          <input name="name" required defaultValue={company?.name} />
        </label>
        <label>
          Nome pra contato
          <input name="nomeParaContato" defaultValue={company?.nomeParaContato ?? ""} />
        </label>
        <label>
          Razão social
          <input name="razaoSocial" {...field("razaoSocial")} />
        </label>
        <label>
          Fantasia
          <input name="fantasia" {...field("fantasia")} />
        </label>
        <label>
          CPF/CNPJ
          <input name="cpfCnpj" {...field("cpfCnpj")} />
        </label>
        <label>
          Tipo
          <select name="tipo" {...field("tipo")}>
            <option value="">—</option>
            <option value="PF">Pessoa física</option>
            <option value="PJ">Pessoa jurídica</option>
          </select>
        </label>
        <label>
          Domínio
          <input name="domain" placeholder="empresa.com.br" defaultValue={company?.domain ?? ""} />
        </label>
        <label>
          Setor
          <input name="industry" defaultValue={company?.industry ?? ""} />
        </label>
        <label>
          Porte
          <input name="size" defaultValue={company?.size ?? ""} />
        </label>
        <label>
          Data de nascimento
          <input name="dtNasc" type="date" defaultValue={company?.dtNasc?.slice(0, 10) ?? ""} />
        </label>
        <label>
          Data de cadastro
          <input name="dtCad" type="date" defaultValue={company?.dtCad?.slice(0, 10) ?? ""} />
        </label>
        <label>
          E-mails (separados por vírgula)
          <input name="emails" {...field("emails")} />
        </label>
        <label>
          Telefones (separados por vírgula)
          <input name="fones" {...field("fones")} />
        </label>
        <label>
          Logradouro
          <input name="logradouro" {...field("logradouro")} />
        </label>
        <label>
          Número
          <input name="numero" {...field("numero")} />
        </label>
        <label>
          Complemento
          <input name="complemento" {...field("complemento")} />
        </label>
        <label>
          Bairro
          <input name="bairro" {...field("bairro")} />
        </label>
        <label>
          CEP
          <input name="cep" {...field("cep")} />
        </label>
        <label>
          Cidade
          <input name="cidade" {...field("cidade")} />
        </label>
        <label>
          UF
          <input name="uf" maxLength={2} {...field("uf")} />
        </label>
        <label>
          Tags (separadas por vírgula)
          <input name="tags" defaultValue={company?.tags.join(", ") ?? ""} />
        </label>
        <button type="submit" className="btn btn-primary">
          {company ? "Salvar cadastro" : "Nova empresa"}
        </button>
      </form>
    </div>
  );
}
