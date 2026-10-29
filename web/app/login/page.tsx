import { signIn } from "./actions";
import SubmitButton from "@/app/_components/submit-button";
import { IS_BETA } from "@/lib/ambiente";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <img
          src="/logo-gama.svg"
          alt="Gama Brasil"
          className="auth-logo"
          width={138}
          height={34}
        />
        <p className="auth-sub">
          Entrar no CRM {IS_BETA && <span className="beta-badge">Beta</span>}
        </p>

        {params.error && <p className="auth-error">{params.error}</p>}

        <form action={signIn} className="auth-form">
          <label>
            Login
            <input type="text" name="email" required autoComplete="username" />
          </label>
          <label>
            Senha
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </label>
          <SubmitButton pendingLabel="Entrando…">Entrar</SubmitButton>
        </form>
      </div>
    </main>
  );
}
