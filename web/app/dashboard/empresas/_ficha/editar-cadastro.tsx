"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/app/_components/action-form";
import SubmitButton from "@/app/_components/submit-button";
import { REFRESH_SESSION_KEY } from "@/app/dashboard/_overlay/toast";
import type { Company } from "@/lib/api/types";
import { updateCompanyAction } from "../actions";

// Edição do cadastro da empresa DENTRO da ficha (pedido do usuário,
// 2026-09-16: "aquele formulário feio de novo — já pedi isso antes"). O
// modal de 20 campos empilhados (company-form.tsx) e as rotas
// /empresas/[id]/editar foram apagados; todo "Editar" (ícone da lista,
// botão da ficha lateral e da ficha em página cheia) abre a ficha na aba
// "Dados cadastrais" com ?editar=1, e este bloco aparece no lugar da
// leitura — mesma moldura e mesmos blocos do cadastro de empresa nova
// (_ficha/nova-ficha.tsx).
//
// Os campos que o cadastro novo deixou de fora (nome pra contato, domínio,
// setor, porte, datas) ficam aqui, no bloco "Outros dados": sem ele,
// apagar o modal tiraria a única forma de corrigir esses campos em
// registros vindos do eGestor.
//
// Salvar fica na mesma ficha: avisa, sai do modo edição trocando a URL
// (mesma navegação das abas, que funciona dentro da gaveta) e marca a
// lista de trás pra atualizar quando a ficha fechar.
export default function EditarCadastro({ company }: { company: Company }) {
  const router = useRouter();
  const leitura = `/dashboard/empresas/${company.id}?aba=cadastro`;
  const [state, formAction] = useActionState<FormState, FormData>(updateCompanyAction, null);
  const tratado = useRef<FormState>(null);

  useEffect(() => {
    if (!state?.ok || tratado.current === state) return;
    tratado.current = state;
    window.dispatchEvent(new CustomEvent("crm:toast", { detail: state.message ?? "Empresa atualizada" }));
    sessionStorage.setItem(REFRESH_SESSION_KEY, "1");
    router.replace(leitura, { scroll: false });
  }, [state, router, leitura]);

  const data = (valor: string | null) => valor?.slice(0, 10) ?? "";

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={company.id} />

      <div className="lembrete-salvar">
        Editando o cadastro. Os dados da Receita e a Inscrição Estadual continuam na leitura desta aba — é
        só salvar ou cancelar para voltar a ela.
      </div>

      {state && !state.ok && <div className="error-banner">{state.message}</div>}

      <div className="drawer-section-title">Identificação</div>
      <div className="form-grid">
        <label>
          Razão social
          <input name="razaoSocial" maxLength={255} defaultValue={company.razaoSocial ?? ""} />
        </label>
        <label>
          Fantasia
          <input name="fantasia" maxLength={255} defaultValue={company.fantasia ?? ""} />
        </label>
        <label>
          CPF/CNPJ
          <input name="cpfCnpj" maxLength={20} defaultValue={company.cpfCnpj ?? ""} />
        </label>
        <label>
          Tipo
          <select name="tipo" defaultValue={company.tipo ?? ""}>
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
            defaultValue={company.emails.join(", ")}
          />
        </label>
        <label>
          Telefones
          <input
            name="fones"
            placeholder="(51) 3333-4444, (51) 99999-8888"
            defaultValue={company.fones.join(", ")}
          />
        </label>
      </div>
      <p className="t-sub" style={{ marginTop: 6 }}>
        Mais de um: separe por vírgula. Pessoa de contato com nome e cargo fica na aba Contatos.
      </p>

      <div className="drawer-section-title" style={{ marginTop: 20 }}>
        Endereço
      </div>
      <div className="form-grid">
        <label>
          CEP
          <input name="cep" maxLength={9} defaultValue={company.cep ?? ""} />
        </label>
        <label>
          Logradouro
          <input name="logradouro" maxLength={255} defaultValue={company.logradouro ?? ""} />
        </label>
        <label>
          Número
          <input name="numero" maxLength={20} defaultValue={company.numero ?? ""} />
        </label>
        <label>
          Complemento
          <input name="complemento" maxLength={255} defaultValue={company.complemento ?? ""} />
        </label>
        <label>
          Bairro
          <input name="bairro" maxLength={255} defaultValue={company.bairro ?? ""} />
        </label>
        <label>
          Cidade
          <input name="cidade" maxLength={255} defaultValue={company.cidade ?? ""} />
        </label>
        <label>
          UF
          <input name="uf" maxLength={2} placeholder="RS" defaultValue={company.uf ?? ""} />
        </label>
      </div>

      <div className="drawer-section-title" style={{ marginTop: 20 }}>
        Classificação
      </div>
      <div className="form-grid">
        <label>
          Tags
          <input name="tags" placeholder="cliente, revenda" defaultValue={company.tags.join(", ")} />
        </label>
      </div>
      <p className="t-sub" style={{ marginTop: 6 }}>
        Separadas por vírgula. A tag <strong>cliente</strong> é o que faz a empresa aparecer como cliente (e
        não como lead) nas listas.
      </p>

      <div className="drawer-section-title" style={{ marginTop: 20 }}>
        Outros dados
      </div>
      <div className="form-grid">
        <label>
          Nome pra contato
          <input name="nomeParaContato" defaultValue={company.nomeParaContato ?? ""} />
        </label>
        <label>
          Domínio
          <input name="domain" placeholder="empresa.com.br" defaultValue={company.domain ?? ""} />
        </label>
        <label>
          Setor
          <input name="industry" defaultValue={company.industry ?? ""} />
        </label>
        <label>
          Porte
          <input name="size" defaultValue={company.size ?? ""} />
        </label>
        <label>
          Data de nascimento
          <input name="dtNasc" type="date" defaultValue={data(company.dtNasc)} />
        </label>
        <label>
          Data de cadastro
          <input name="dtCad" type="date" defaultValue={data(company.dtCad)} />
        </label>
      </div>

      <div className="row-form" style={{ justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
        <Link href={leitura} replace scroll={false} className="btn btn-ghost">
          Cancelar
        </Link>
        <SubmitButton className="btn btn-primary" pendingLabel="Salvando…">
          ✓ Salvar cadastro
        </SubmitButton>
      </div>
    </form>
  );
}
