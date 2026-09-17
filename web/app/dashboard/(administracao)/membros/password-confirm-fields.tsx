"use client";

import { useRef, useState } from "react";

// Compartilhado entre member-form.tsx (Novo membro, senha obrigatória) e
// member-edit-form.tsx (Editar, senha opcional — vazio mantém a atual).
// Client component embutido num Server Component (mesmo padrão já usado
// em TipoContatoFields/NoteTypeFields) — só assim dá pra validar em tempo
// real que as duas senhas digitadas coincidem, mitigando erro de
// digitação (pedido do usuário, 2026-08-06) antes de gerar/comunicar uma
// senha errada pro membro.
//
// "Confirmar senha" não tem `name` — nunca viaja no FormData nem chega
// no backend, é só uma segunda digitação pra conferência local.
//
// BUG REAL corrigido (2026-08-06, usuário reportou "clico em Salvar e não
// acontece nada"): a versão original bloqueava o submit só via
// `setCustomValidity` (Constraint Validation API nativa) — funciona (o
// navegador realmente impede o envio), mas o balão de erro do navegador
// fica cortado/invisível dentro do modal (`.overlay` tem
// `overflow-y: auto`), então o clique parecia não fazer nada, sem
// nenhuma pista do motivo. Mantido o `setCustomValidity` como reforço
// (garante que o form nunca submete com senhas divergentes mesmo se o
// usuário nunca vir o texto abaixo), mas agora com um texto sempre
// visível (`.field-error`) mostrando o problema.
export default function PasswordConfirmFields({
  label,
  required = false,
  placeholder,
}: {
  label: string;
  required?: boolean;
  placeholder?: string;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [mismatch, setMismatch] = useState(false);

  function checkMatch() {
    const password = passwordRef.current?.value ?? "";
    const confirm = confirmRef.current?.value ?? "";
    // Os dois em branco é válido no form de edição (mantém a senha
    // atual) — só exige coincidência quando pelo menos um foi
    // preenchido.
    const bothEmpty = !password && !confirm;
    const matches = password === confirm;
    confirmRef.current?.setCustomValidity(bothEmpty || matches ? "" : "As senhas não coincidem.");
    setMismatch(!bothEmpty && !matches);
  }

  return (
    <>
      <label>
        {label}
        <input
          ref={passwordRef}
          type="password"
          name="password"
          required={required}
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder={placeholder}
          onChange={checkMatch}
        />
      </label>
      <label>
        Confirmar senha
        <input
          ref={confirmRef}
          type="password"
          required={required}
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder={placeholder}
          onChange={checkMatch}
        />
        {mismatch && <div className="field-error">As senhas não coincidem.</div>}
      </label>
    </>
  );
}
