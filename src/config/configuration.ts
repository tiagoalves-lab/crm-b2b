export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  // Opcional (não entra em REQUIRED_VARS): só é exigida quando o upload
  // de anexos é de fato usado (SupabaseStorageService), não no boot da
  // aplicação — mesmo raciocínio de não travar o resto do app por uma
  // feature que pode ainda não estar configurada em todo ambiente.
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  frontendOrigin:
    process.env.FRONTEND_ORIGIN ??
    (process.env.NODE_ENV === 'production'
      ? undefined
      : 'http://localhost:3000'),
});
