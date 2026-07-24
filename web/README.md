# CRM B2B — Frontend (esqueleto)

Esqueleto Next.js (App Router) com login real via Supabase Auth e um shell
de navegação (sidebar + rotas por seção). **Nenhuma tela tem dado real
ainda** — todas mostram um placeholder até a Fase 1/3 do
[`../docs/roadmap.md`](../docs/roadmap.md) estarem prontas. Ver a nota na
Fase 6 desse roadmap sobre por que isso foi adiantado fora de ordem.

## 1. Configurar o Supabase

1. No painel do seu projeto Supabase: **Project Settings → API** — copie a
   `Project URL` e a `anon public key`.
2. `cp .env.local.example .env.local` e preencha as duas variáveis.
3. **Criar o primeiro usuário manualmente** — este esqueleto só tem tela de
   login, não de cadastro (isso é Fase 2 do roadmap, ainda não existe). Vá
   em **Authentication → Users → Add user** no painel do Supabase e crie um
   usuário com e-mail/senha pra poder testar o login.

## 2. Rodar localmente

```sh
npm install
npm run dev
```

Abre em `http://localhost:3000`. Sem sessão, redireciona pra `/login`; após
logar, vai pra `/dashboard`.

## 3. Deploy (Vercel)

Ainda não há um remote git configurado pro repositório (só existe local por
enquanto), então o caminho mais rápido pra ter uma URL agora é o deploy
direto pela CLI, sem depender de GitHub:

```sh
npm install -g vercel   # ou: npx vercel (fora deste projeto, pra não reativar o problema de lock do npx aqui)
vercel login            # abre o navegador pra autenticar na sua conta
vercel                  # rodar de dentro da pasta web/ — deploy de preview
vercel --prod           # promove pra produção, com URL fixa
```

Na primeira execução ele pergunta o nome do projeto e se quer linkar a um
projeto Vercel existente — responda conforme sua conta.

**Variáveis de ambiente na Vercel:** o `vercel` CLI não lê o `.env.local`
automaticamente para o ambiente de produção — configure as mesmas duas
variáveis (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) em
**Project Settings → Environment Variables** no painel da Vercel, ou via
`vercel env add NEXT_PUBLIC_SUPABASE_URL`.

**Alternativa (deploy contínuo via git):** se preferir que todo `git push`
gere um deploy automático, crie um repositório no GitHub, adicione como
remote (`git remote add origin <url>`, `git push -u origin master`) e
conecte esse repo pelo painel da Vercel (**Add New → Project → Import Git
Repository**) em vez de usar a CLI direto.

## 4. Depois disso

Cada página em `app/dashboard/*/page.tsx` é só um placeholder explicando do
que ela depende — conforme a Fase 1 (dados), Fase 2 (convite/RBAC completo)
e Fase 3 (API) do roadmap forem saindo, essas páginas trocam de placeholder
pra tela real, uma de cada vez.
