"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { REFRESH_SESSION_KEY, TOAST_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { CnpjLookupResult } from "@/lib/api/companies";
import type { Company } from "@/lib/api/types";
import { createCompanyAction, updateCompanyAction } from "./actions";
import SubmitButton from "@/app/_components/submit-button";

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
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(() => fieldsFrom(company));
  const [cnpjQuery, setCnpjQuery] = useState(company?.cpfCnpj ?? "");
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Cadastro (sem `company`) fecha o modal via router.back() depois de
  // criar — mesmo mecanismo que já fecha o drawer/modal pelo X
  // (overlay-modal.tsx/overlay-drawer.tsx). Testado à parte (sandbox
  // isolado, ver histórico da sessão): nem redirect() de dentro da Server
  // Action nem router.push() pro fundo colapsam o slot @modal da rota
  // interceptada — só router.back() funciona de verdade. router.back()
  // não aceita querystring, por isso o toast vai via sessionStorage (ver
  // toast.tsx) em vez de ?msg=. Edição continua no
  // <form action={updateCompanyAction}> de sempre (fica na mesma rota,
  // não precisa fechar nada).
  const [createState, createFormAction] = useActionState(createCompanyAction, null);
  useEffect(() => {
    if (createState?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, "Empresa criada");
      sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
      router.back();
    }
  }, [createState, router]);

  // Edição (2026-09-03): mesmo caminho do cadastro — a action devolve o
  // resultado, o modal fecha com router.back() e a ficha de trás recebe
  // refresh ao chegar (REFRESH_SESSION_KEY, ver toast.tsx). Antes era
  // redirect(), que fechava e reabria o modal.
  const [updateState, updateFormAction] = useActionState(updateCompanyAction, null);
  useEffect(() => {
    if (updateState?.ok) {
      sessionStorage.setItem(TOAST_SESSION_KEY, updateState.message ?? "Empresa atualizada");
      sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
      router.back();
    }
  }, [updateState, router]);

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
      {createState?.ok === false && <div className="error-banner">{createState.message}</div>}
      {updateState?.ok === false && <div className="error-banner">{updateState.message}</div>}
      <p className="field-hint" style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: -4, marginBottom: 12 }}>
        Puxa razão social, endereço e situação da Receita Federal (BrasilAPI). A Inscrição
        Estadual é dado da SEFAZ e entra à parte, na seção &ldquo;Dados fiscais estaduais&rdquo; abaixo.
      </p>
      <p className="field-hint" style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: -4, marginBottom: 12 }}>
        Preencha ao menos Razão social ou Fantasia — é o que identifica a empresa nas listas e
        cards do sistema.
      </p>

      <form action={company ? updateFormAction : createFormAction} className="form-grid">
        {company && <input type="hidden" name="id" value={company.id} />}
        {backHref && <input type="hidden" name="back" value={backHref} />}
        <label>
          Nome pra contato
          <input name="nomeParaContato" defaultValue={company?.nomeParaContato ?? ""} />
        </label>
        <label>
          Razão social*
          <input name="razaoSocial" {...field("razaoSocial")} />
        </label>
        <label>
          Fantasia*
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
        <SubmitButton className="btn btn-primary" pendingLabel="Salvando…">
          {company ? "Salvar cadastro" : "Nova empresa"}
        </SubmitButton>
      </form>
    </div>
  );
}
