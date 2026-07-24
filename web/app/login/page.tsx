import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-mark">GB</div>
        <h1>Gama Brasil</h1>
        <p className="auth-sub">Entrar no CRM</p>

        {params.error && <p className="auth-error">{params.error}</p>}

        <form action={signIn} className="auth-form">
          <label>
            E-mail
            <input type="email" name="email" required autoComplete="email" />
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
          <button type="submit">Entrar</button>
        </form>
      </div>
    </main>
  );
}
