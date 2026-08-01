"use client";

// Botão de submit com confirm() nativo antes de deixar o form ir —
// `formAction` troca a Server Action só deste botão (o resto do form
// aponta pra outra, ver member-edit-form.tsx: Salvar/Remover na mesma
// tag <form>). Sem lib nova; confirm() é o suficiente pra uma ação
// destrutiva de baixo risco (remove 1 membro, não é bulk).
export default function ConfirmSubmitButton({
  formAction,
  confirmMessage,
  className,
  children,
}: {
  formAction: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      formAction={formAction}
      className={className}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
