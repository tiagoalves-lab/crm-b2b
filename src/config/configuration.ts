export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  frontendOrigin:
    process.env.FRONTEND_ORIGIN ??
    (process.env.NODE_ENV === 'production'
      ? undefined
      : 'http://localhost:3000'),
});
