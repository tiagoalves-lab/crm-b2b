# E-mails que o CRM envia

Doc técnico de tudo que o CRM manda por e-mail. São duas camadas, com
propósitos diferentes:

1. **Resumo diário do Pipeline** — agendado, em lote, para a gestão. É o
   assunto da maior parte deste doc. Código em `src/reports/`.
2. **Avisos pontuais** — reação imediata a um fato: tarefa designada,
   membro destacado numa anotação e **lead novo entrando pelos anúncios do
   Meta**. Seção própria no fim. Código em `src/notifications/`.

As duas usam o mesmo `src/mail/` (como o e-mail sai) e o mesmo domínio de
envio.

O envio é **de mão única**: o CRM dispara e não recebe nada de volta.
Resposta de quem lê cai na caixa corporativa pelo `Reply-To`, fora do
sistema.

## Decisões

### 1.1 Quem recebe

**Decisão →** Todo membro **ativo** do workspace, **exceto representante**
(`sales_rep`). Todos recebem o **mesmo conteúdo**: o quadro inteiro da
empresa, não a carteira de cada um.
**Fonte →** Pedido do usuário, 2026-09-15 ("envie para todos os membros
exceto representantes; gerente para cima na hierarquia recebem todos").

A lista sai do próprio CRM a cada envio — não há lista fixa para manter.
Incluir ou excluir alguém é cadastrar/inativar o membro na tela de Membros.

O endereço usado é o **e-mail de contato** do membro (`user_metadata.email`
no Supabase Auth, campo "E-mail" da tela de Membros), nunca o login — o
login é um endereço sintético `@login.gamabrasil.com.br`, sem caixa de
entrada. Membro de gestão sem e-mail de contato preenchido simplesmente não
recebe, e isso vira aviso no log do Railway (não silêncio).

### 1.2 O que o e-mail traz

**Decisão →** Três seções, nesta ordem: **pipeline de oportunidades** (em
tabela: Nr, abertura, fechamento previsto, empresa, representante, status,
SLA e itens), **comentários fixados** e **tarefas pendentes** (agrupadas em
atrasadas / para hoje / próximos dias). O cabeçalho repete os três números
que resumem o dia: valor em aberto, oportunidades abertas e tarefas
atrasadas.
**Fonte →** Pedido do usuário, 2026-09-15; layout escolhido por ele entre
três opções (quadro, tabela e lista) na prévia do mesmo dia.

A numeração `Nr` segue a **sequência do quadro**: primeiro os cards da
primeira etapa, depois os da segunda, e assim por diante; dentro da etapa,
a mesma ordem em que os cards aparecem no quadro — é o que permite
ir da linha da tabela ao card do Pipeline. Cada etapa tem uma cor própria,
a mesma legenda usada no quadro.

O SLA é a mesma conta do selo do card (decisão 5.11 de
`regras-de-negocio.md`; código em `src/opportunities/opportunity-sla.ts`):
dias úteis do início (revisão ou abertura) até a proposta ir para
Negociação ou, se ainda pendente, até hoje.

Oportunidade sem valor preenchido aparece como **"a definir"**, e o rodapé
informa quantas estão assim — nunca como `R$ 0`, que significaria outra
coisa.

### 1.3 Quando sai

**Decisão →** 8h, de segunda a sexta, no fuso de Brasília
(`REPORT_CRON_PIPELINE`, padrão `0 8 * * 1-5`).
**Fonte →** Pedido do usuário, 2026-09-15.

O fuso é explícito no agendador (`timeZone`): o container do Railway roda
em UTC, e sem isso "8h" seria 8h de Londres — e ainda derraparia uma hora
duas vezes por ano, no horário de verão do hemisfério norte.

### 1.4 Um e-mail por dia, em qualquer circunstância

**Decisão →** Três camadas contra envio duplicado, porque redeploy,
restart ou disparo manual podem cair no mesmo dia:

1. o agendador consulta `report_log` antes de montar qualquer coisa;
2. `report_log` tem índice **único** por (workspace, tipo, dia) — duas
   execuções simultâneas fazem a segunda estourar violação de unicidade em
   vez de gerar um segundo e-mail;
3. o envio vai com `Idempotency-Key` (`report-pipeline-diario:AAAA-MM-DD`),
   que o provedor honra por 24h — exatamente a cadência diária.

**Fonte →** Plano de implementação da feature, 2026-09-15.

### 1.5 Falha não pode ser silenciosa

**Decisão →** Toda tentativa de envio grava linha em `report_log`
(`enviado` ou `falha`, com o motivo). Um segundo job, às 9h, confere se o
resumo do dia saiu; se não saiu, manda um aviso curto para
`REPORT_ALERTA_TO` (ou, vazio, para o primeiro destinatário do dia).
**Fonte →** Plano de implementação da feature, 2026-09-15.

O motivo de existir: report que não chega **não gera reclamação** — o time
apenas assume que não houve movimento no dia.

O job de conferência não tenta reenviar: se o envio falhou por credencial
ou domínio, reenviar falharia igual. O que resolve é alguém olhar.

### 1.6 Este canal não serve para prospecção

**Decisão →** O domínio de envio é usado **só** para reports internos.
Nunca para prospecção fria, campanha ou qualquer disparo em lote para
quem não é da Gama.
**Fonte →** Termos de uso de provedor transacional + reputação de envio.

Marketing por plano transacional fere os termos do provedor e queima a
reputação do subdomínio — o que contaminaria a entrega dos reports
legítimos, que é justamente o que se quer proteger.

## Infraestrutura de envio

- **Provedor:** Resend (API transacional). Chamado por `fetch` direto em
  `src/mail/mail.service.ts`, sem SDK — mesmo critério do eGestor/Meta/
  BrasilAPI: o corpo é um JSON de quatro campos, e uma dependência a menos
  é uma superfície a menos para auditar.
- **Domínio:** subdomínio dedicado **`crm-send.gamabrasil.com.br`**
  (escolha do usuário, 2026-09-15), com MX, SPF e DKIM publicados **nele**,
  nunca no domínio principal — isola a reputação de envio do e-mail
  corporativo e não encosta no MX que a equipe usa.
- **DMARC:** `_dmarc.crm-send` com `p=none` + `rua` no começo, para
  observar antes de endurecer a política.
- **Remetente:** fixado no ambiente (`MAIL_FROM`). Quem chama o
  `MailService` escolhe destinatário, assunto e corpo — **nunca** de quem o
  e-mail parece ter vindo.
- **Cota do plano gratuito:** 3.000 e-mails/mês com teto de **100 por
  dia**. O resumo gasta **1 por dia** (um envio para a lista inteira, não
  um por pessoa). O teto diário é o limite que apertaria primeiro se algum
  report futuro for personalizado por destinatário.
- **Teto por envio:** 50 endereços no mesmo `to`. Acima disso o
  `MailService` recusa em vez de enviar pela metade.

## Variáveis de ambiente

Todas em `.env.example`, com explicação de cada uma. Só o backend usa;
nenhuma vai para `web/`. Sem `RESEND_API_KEY`/`MAIL_FROM` o CRM sobe e
funciona inteiro — só o resumo não sai, e o motivo fica no log.

## Disparo manual

Duas rotas, só para `owner`/`admin`:

- `POST /reports/pipeline-diario/enviar` — envio real, mesma esteira do
  agendado (inclusive a trava de um por dia). Serve para reenviar o dia em
  que o automático falhou.
- `POST /reports/pipeline-diario/testar?para=alguem@dominio` — manda só
  para aquele endereço, **sem** registrar nada em `report_log`. É o
  caminho para conferir remetente, "responder para" e layout sem gastar o
  envio do dia nem enganar a conferência das 9h.

## Como acrescentar um report novo

1. **Dados:** um método em `ReportService` que devolve o que o report
   mostra. Lê dentro da transação (`TenantTx`); qualquer chamada de rede
   (nomes vindos do Supabase Auth) fica **fora** dela.
2. **Layout:** uma função em um arquivo de template próprio, pura (dados →
   HTML). É o que permite conferir o visual sem banco e sem envio, e é o
   que os testes exercitam.
3. **Agendamento:** um método com `@Cron` em `ReportSchedulerService`,
   sempre com `name` e `timeZone`, e um `tipo` novo (o texto que vai para
   `report_log`).
4. **Trava:** use o mesmo par — consulta ao `report_log` antes + chave de
   idempotência `report-<tipo>:<AAAA-MM-DD>` no envio.
5. **Conferência:** se o report for crítico, inclua o `tipo` no job das 9h.

Regras de HTML de e-mail que valem para qualquer template novo (o motivo
de `report-template.ts` não se parecer com o frontend): estilo **inline**
em cada elemento, layout em `<table>` (o Outlook renderiza com o motor do
Word, que não conhece flex nem grid), fonte do sistema, nenhuma imagem
remota e nenhum JavaScript.

---

# Avisos pontuais

Segunda camada (pedido do usuário, 2026-09-15): e-mail na hora em que o
fato acontece, para a pessoa diretamente envolvida. Nada de agenda, nada
de lote.

## Decisões

### 2.1 Quais eventos disparam e-mail

**Decisão →** Três:

- **tarefa designada a alguém** — na criação e quando o responsável é
  trocado depois;
- **membro destacado numa anotação** do card do Pipeline — no comentário
  novo e quando alguém é acrescentado à lista de destaques depois;
- **lead novo entrando pela Central de Leads do Meta** — tanto pelo
  webhook direto quanto pela planilha do gestor de tráfego, que é o canal
  em uso (ver `webhook-meta-leads.md`).

**Fonte →** Pedido do usuário, 2026-09-15 (os dois primeiros) e
2026-09-18 (o lead novo).

### 2.2 Quem recebe

**Decisão →** Tarefa e destaque vão só para a pessoa diretamente
envolvida: quem ficou com a tarefa, quem foi destacado. **Inclusive
representante** — ao contrário do resumo diário, que exclui `sales_rep`:
ali é panorama de gestão, aqui é o trabalho da própria pessoa.
**Fonte →** Decorrência direta de 2.1.

Quem foi destacado recebe **um e-mail individual**, não uma cópia coletiva:
o texto fala "você", e ninguém precisa ver o endereço dos colegas.

**Decisão →** O aviso de **lead novo** é a exceção: não tem "pessoa
envolvida" (o lead cai na carteira do gerente, mas quem precisa saber na
hora é a equipe), então vai para a **lista escolhida na tela "E-mail
automático"**, num e-mail só para todos. Lista vazia = todo membro ativo
que não é representante, o mesmo padrão dos relatórios.
**Fonte →** Pedido do usuário, 2026-09-18.

Um e-mail para a lista, e não um por pessoa, porque a cota do provedor é
diária: personalizar gastaria N vezes mais sem acrescentar nada — o texto
fala do lead, não de quem lê.

### 2.3 Ninguém recebe aviso da própria ação

**Decisão →** Quem cria uma tarefa para si mesmo, ou se destaca no próprio
comentário, não recebe e-mail.
**Fonte →** A pessoa acabou de digitar aquilo — o e-mail seria ruído.

### 2.4 Só quando o fato é novo

**Decisão →** Na edição de tarefa, o aviso só sai quando o responsável
**mudou** em relação ao que estava gravado. Na edição de destaques, só
para quem **entrou agora** na lista.
**Fonte →** A tela envia o formulário inteiro a cada salvamento; sem essa
comparação, corrigir um título dispararia e-mail para todo mundo de novo.

### 2.5 O aviso nunca atrapalha a ação

**Decisão →** O envio sai **fora da transação** do banco e **fora da
requisição** (adiado com `setImmediate`), e todo erro vira log. Salvar uma
tarefa não pode ficar mais lento, nem falhar, por causa de e-mail.
**Fonte →** Regra do projeto: chamada de rede dentro de `$transaction` já
estourou o pool de conexões aqui antes.

### 2.6 O aviso de lead novo traz o que decide a ligação

**Decisão →** Vão no e-mail: nome/razão social, contato (nome, cargo,
telefone, e-mail), CNPJ e localidade quando houver, a carteira em que o
lead caiu, a hora da entrada, **o que a pessoa respondeu no formulário do
anúncio** e a origem (plataforma, campanha, anúncio, formulário). Mais o
botão que abre a ficha do lead no CRM.
**Fonte →** Pedido do usuário, 2026-09-18.

As respostas do formulário são o motivo de o e-mail existir: sem elas
seria um "chegou um lead, entre no CRM", que não ajuda quem está na rua.

### 2.7 Um aviso por lead, e o registro de que ele saiu

**Decisão →** Cada lead avisado grava uma linha em `report_log` com a
referência `lead <id do lead na Meta>`, e o envio vai com chave de
idempotência do mesmo id. O índice único da tabela impede o segundo aviso
do mesmo lead.
**Fonte →** Mesmo raciocínio da decisão 1.4, aplicado ao evento.

Efeito colateral útil: os avisos aparecem em "Últimos envios" na tela, com
situação e motivo da falha — a mesma resposta para "saiu mesmo?".

### 2.8 Relê o registro antes de enviar

**Decisão →** Antes de mandar, o CRM relê a tarefa/anotação e confirma que
o fato continua valendo (a tarefa existe e é daquela pessoa; a pessoa
ainda consta como destacada). Se não bater, não envia.
**Fonte →** Consequência de 2.5: adiar o envio abre a janela de a
transação ter sido revertida depois. A releitura é uma consulta por índice
— barata — e elimina o aviso sobre algo que não aconteceu.

## Limite a vigiar

O plano gratuito do provedor tem teto de **100 e-mails por dia**. O resumo
diário gasta 1; os avisos pontuais gastam 1 por tarefa designada e 1 por
pessoa destacada. Com a equipe atual sobra folga, mas uma carga em massa
de tarefas (importação, script) passaria do teto — se isso entrar no
roteiro, calcular antes.

## Sem e-mail cadastrado, sem aviso

O endereço sai do mesmo lugar do resumo diário: o campo **E-mail** do
membro na tela de Membros. Quem não tem não recebe, e fica registrado no
log do Railway.

---

# Follow-up das cotações

Terceira camada (pedido do usuário, 2026-09-15). Mesma tabela do resumo
diário, outro recorte e outra cadência: serve para **acompanhar cotação
parada e manter o SLA no alvo**, não para dar panorama.

## Decisões

### 3.1 O que entra

**Decisão →** Só as oportunidades **abertas** das etapas de proposta:
Solicitação de Propostas, Elaboração de Propostas e Aprovação de
Propostas. Negociação e Fechamento fica de fora.
**Fonte →** Pedido do usuário, 2026-09-15.

A lista de etapas é configurável (`REPORT_FOLLOWUP_ETAPAS`) e casada pelo
**nome**, sem diferenciar acento nem maiúscula — renomear a etapa na tela
não pode esvaziar o report em silêncio. Se nenhuma etapa casar, fica um
aviso alto no log em vez de um e-mail vazio sem explicação.

### 3.2 Quando sai

**Decisão →** Quatro vezes por dia útil: **10:00, 11:50, 14:00 e 16:30**
(fuso de Brasília).
**Fonte →** Pedido do usuário, 2026-09-15.

Os horários vivem em `REPORT_FOLLOWUP_HORARIOS` e são registrados em tempo
de execução, não com `@Cron` fixo: mudar horário é mudar uma variável, sem
tocar em código. Lista vazia desliga o report.

### 3.3 Mesma ordem do quadro

**Decisão →** A lista segue a **ordem do quadro do Pipeline**, igual ao
resumo diário: etapa por etapa e, dentro da etapa, a ordem dos cards.
**Fonte →** Pedido do usuário, 2026-09-16: a prioridade é gerenciada no
quadro, e o time precisa se acostumar a trabalhar por lá.

O cabeçalho destaca o maior SLA da lista — "a mais antiga" — em vermelho.

### 3.4 Silêncio quando não há nada

**Decisão →** Se não houver nenhuma cotação nas etapas acompanhadas, o
e-mail **não é enviado**; fica só o registro em `report_log`.
**Fonte →** Quatro e-mails por dia dizendo "não há cotações" viram ruído,
e o time para de abrir os que importam.

### 3.5 Uma trava por rodada, não por dia

**Decisão →** A chave de idempotência e o registro em `report_log` usam
**dia + horário** (`2026-09-15 10h`), não só o dia.
**Fonte →** São quatro rodadas no mesmo dia; travar por dia mataria as
três seguintes.

O job de conferência das 9h continua olhando **só o resumo diário** —
falha de uma rodada do follow-up aparece no log, e a rodada seguinte (no
máximo 2h30 depois) resolve na prática.

### 3.6 Quem recebe

**Decisão →** A mesma lista do resumo diário: todo membro ativo exceto
representante.
**Fonte →** Decisão 1.1, aplicada por consistência.

---

# Tela "E-mail automático" (Administração)

Quarta entrega (pedido do usuário, 2026-09-15): `/dashboard/e-mail-automatico`,
visível só para owner/admin. É onde se configuram o **resumo diário**, o
**follow-up das cotações** e o **aviso de lead novo do Meta** (2026-09-18).

O aviso de lead entra na tela mesmo sem ter horário porque tem as mesmas
duas perguntas dos relatórios: está ligado? quem recebe? O card dele não
mostra horário, dia útil nem "enviar agora" — só liga/desliga, envio de
teste (com um lead fictício) e a lista de quem recebe.

Os avisos de tarefa designada e de destaque em anotação continuam fora de
propósito: quem recebe é sempre a pessoa envolvida, não há nada a
escolher.

## Decisões

### 4.1 A configuração saiu do ambiente e foi para o banco

**Decisão →** Horários, dias, etapas e liga/desliga vivem na tabela
`report_config`. As variáveis de ambiente viraram só o **padrão** de quem
nunca salvou nada — exatamente o que valia antes da tela existir.
**Fonte →** Pedido do usuário, 2026-09-15 ("crie um form para configurar
o que projetamos aqui").

Sem isso, mudar um horário exigiria deploy.

### 4.2 Um tick de minuto em minuto, em vez de um job por horário

**Decisão →** Existe **um** job agendado (`report-tick`), que roda a cada
minuto, lê a configuração e decide se algum report é para sair agora.
**Fonte →** Horário editável na tela não tem como reprogramar um `@Cron`
fixo sem reiniciar o processo. Com o tick, o que foi salvo vale no minuto
seguinte.

Detalhes que sustentam a escolha:

- O rótulo da rodada vem da **configuração**, não do relógio: um tick
  atrasado alguns segundos não vira uma rodada nova.
- Há tolerância de 5 minutos, para o caso de o processo estar ocupado (ou
  subindo) no minuto exato. Recuperar não vira duplicata porque a trava
  de `report_log` continua valendo.
- O tick é barato: duas consultas pequenas por minuto.

### 4.3 O que a tela impede

**Decisão →** O backend recusa, com mensagem: horário fora do formato
HH:MM, report ativo sem nenhum horário, follow-up ativo sem nenhuma etapa
e mais de um horário no resumo diário.
**Fonte →** Configuração aceita e silenciosamente inútil é pior que erro
— dois horários no resumo diário, por exemplo, nunca gerariam o segundo
e-mail (a trava é de um por dia).

### 4.4 A tela também mostra o que já aconteceu

**Decisão →** Além do formulário: a lista de **quem recebe** (com quem
está sem e-mail cadastrado em destaque) e os **últimos 20 envios**, com
situação e motivo da falha.
**Fonte →** As duas perguntas que um relatório automático gera são "por
que não recebi?" e "saiu mesmo?". A tela responde as duas sem precisar de
alguém olhar log de servidor.

Cada report ainda tem dois botões: **enviar um teste** para um endereço
(não registra nada) e **enviar agora para todos** (mesma esteira do
agendado, inclusive a trava de repetição).

### 4.5 Cada relatório tem a sua lista de quem recebe

**Decisão →** O bloco "Quem recebe" vive **dentro de cada relatório**, logo
abaixo do envio de teste, com uma caixinha por membro. A lista é
independente entre o resumo diário e o follow-up.
**Fonte →** Pedido do usuário, 2026-09-15 ("coloque dentro de Follow-up de
cotações (fica customizado) e dentro também de Resumo diário").

Três regras que sustentam isso:

- **Lista vazia = todos os elegíveis.** É o padrão, e é o que já valia
  antes de a lista existir — quem nunca mexer continua recebendo igual. Na
  tela, isso aparece com todas as caixinhas marcadas.
- **Só membro elegível entra.** A checagem é no servidor
  (`ReportConfigService#salvar`): mandar o id de um representante, de
  alguém inativo ou de outro workspace no formulário devolve 400. Sem
  isso, a regra "representante não recebe o panorama" cairia por um campo
  de formulário.
- **A lista é filtrada de novo a cada envio.** Quem virou representante ou
  foi inativado depois de ser escolhido para de receber sozinho, sem
  ninguém precisar editar nada.
