"use client";

import { useFormStatus } from "react-dom";

// Botão de submit com confirm() nativo antes de deixar o form ir —
// `formAction` troca a Server Action só deste botão (o resto do form
// aponta pra outra, ver member-edit-form.tsx: Salvar/Remover na mesma
// tag <form>). Sem lib nova; confirm() é o suficiente pra uma ação
// destrutiva de baixo risco (remove 1 membro, não é bulk).
//
// `useFormStatus` aqui pelo mesmo motivo do SubmitButton
// (app/_components/submit-button.tsx): sem ele o botão seguia clicável
// durante a ação e dava pra remover o mesmo membro duas vezes. Note que
// `pending` fica true pra QUALQUER envio do form ancestral — inclusive o
// "Salvar", que usa outra action — e isso é o desejado: enquanto um envio
// corre, nenhum outro botão do mesmo form deve aceitar clique.
export default function ConfirmSubmitButton({
  formAction,
  confirmMessage,
  className,
  title,
  disabled,
  pendingLabel,
  children,
}: {
  formAction: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  className?: string;
  title?: string;
  disabled?: boolean;
  // Texto que substitui o rótulo enquanto a ação corre — mesmo contrato do
  // SubmitButton (app/_components/submit-button.tsx). Sem ele o único
  // sinal era o botão desabilitar, o que numa ação lenta (escrita no
  // eGestor, vários round-trips até o ERP) lê como tela travada.
  pendingLabel?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={formAction}
      className={className}
      title={title}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
