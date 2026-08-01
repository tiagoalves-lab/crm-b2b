// Supabase Auth exige um identificador em formato de e-mail (não dá pra
// mudar isso sem trocar de provedor de auth) — mas o usuário quer digitar
// só um "login" simples, sem @. Resolve os dois lados: se o que foi
// digitado já parece um e-mail, usa como está; senão, completa com um
// domínio interno fixo só pra satisfazer o formato exigido pelo Supabase.
// Usado só no sign-in (login/actions.ts), que fala direto com o Supabase
// sem passar pelo backend. A criação de membro NÃO usa isto — o backend
// (SupabaseUserService) faz a mesma conversão internamente, então web/
// nunca lida com e-mail nesse fluxo. Precisa ser o MESMO domínio dos dois
// lados (LOGIN_DOMAIN aqui / LOGIN_DOMAIN em supabase-user.service.ts),
// senão o membro criado com "tiago" não consegue entrar digitando "tiago".
const LOGIN_DOMAIN = "login.gamabrasil.com.br";

export function toLoginEmail(rawLogin: string): string {
  const login = rawLogin.trim().toLowerCase();
  if (login.includes("@")) return login;
  return `${login}@${LOGIN_DOMAIN}`;
}
