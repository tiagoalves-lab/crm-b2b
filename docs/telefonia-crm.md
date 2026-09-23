# Telefonia no CRM — ligar para o lead sem sair da tela

> **Como usar este arquivo**: é um documento de trabalho, você pode editar
> direto. A pergunta que ainda não tem resposta está marcada `❓ DÚVIDA` —
> responde embaixo dela (ou no chat) que eu releio antes de implementar.
> O que já está fechado vive na lista numerada.

---

## Ponto de partida

A Gama já tem uma linha ativa na BR DID, com número fixo de Santa Maria —
ou seja, a parte mais burocrática (operadora, número, DDD local) já está
resolvida. O que falta é o CRM conversar com essa linha.

Duas constatações que mudaram o plano original:

- **Essa linha não funciona dentro do navegador.** Ela é entregue no
  formato tradicional de telefonia (servidor e porta 5060), que o
  navegador não consegue usar. O caminho é um programa de telefone no
  computador do SDR — o **MicroSIP**, que é o que a própria BR DID
  recomenda para uso no PC, já que o aplicativo deles só existe para
  celular.
- **Isso não nos obriga a abrir mão do registro automático.** O MicroSIP
  aceita ser comandado de fora (o CRM manda discar) e avisa quando uma
  chamada começa e termina. É esse gancho que faz a ligação virar
  registro sozinha — sem o SDR anotar nada.

---

## O que muda no dia a dia do SDR

- **Botão "Ligar" ao lado de todo telefone** — na ficha do lead, na ficha
  da empresa, na agenda de contatos e dentro da tarefa do tipo Ligação.
  Um clique e o telefone do computador já disca, sem digitar número.
- **Ao lado do botão de ligar fica o lembrete do aviso de gravação**, com
  a frase pronta para o SDR falar na abertura. Ele continua visível na
  barra da chamada enquanto a conversa acontece.
- **A conversa acontece no headset**, pela linha da Gama: o cliente vê o
  número fixo da empresa no visor, não o celular do vendedor.
- **Ao desligar, o registro nasce sozinho** na Timeline da empresa: quem
  ligou, para qual contato, quando, quanto durou e se foi atendida.
- **A gravação sobe para o CRM** e fica anexada ao registro, disponível
  para ouvir na própria ficha.
- **Minutos depois, o resumo aparece embaixo** — a conversa é transcrita
  e resumida automaticamente: o que o cliente falou, objeções e próximos
  passos. O SDR corrige/completa se quiser.
- **A tarefa de ligação se fecha** com o resultado, e o "último contato"
  da empresa se atualiza — o que já alimenta Painel, relatórios e o
  resumo diário por e-mail.

---

## Decisões já fechadas

**1.1**
- Decisão → A linha continua sendo a da **BR DID**, que a Gama já paga. Não
  vamos contratar plataforma de telefonia nova.
- Fonte → Linha já ativa, com número fixo de Santa Maria.

**1.2**
- Decisão → O telefone no computador é o **MicroSIP**, instalado na
  máquina de cada SDR, com headset.
- Fonte → Orientação da própria BR DID (o aplicativo deles não tem versão
  para computador) e limitação técnica da linha, que não roda no
  navegador.

**1.3**
- Decisão → O CRM **comanda o MicroSIP**: o botão "Ligar" já manda o
  número discado. O SDR não digita número em lugar nenhum.
- Fonte → Recurso documentado do MicroSIP.

**1.4**
- Decisão → Um **programa pequeno roda no computador do SDR**, em segundo
  plano, ligado ao MicroSIP: ele avisa o CRM quando a chamada começa e
  termina e envia a gravação. É o que transforma ligação em registro sem
  ninguém anotar.
- Fonte → Recomendação do engenheiro — é a única peça que falta para o
  automático funcionar, já que a linha não passa pelo nosso servidor.

**1.5**
- Decisão → **Toda chamada vira registro**, atendida ou não. Ligação sem
  resposta aparece como não atendida — é informação de vendas tanto
  quanto a atendida.
- Fonte → Recomendação do engenheiro.

**1.6**
- Decisão → A gravação **não fica no computador do SDR**: sobe para o
  armazenamento do CRM assim que a chamada termina e é apagada da máquina
  em seguida. Áudio de conversa com cliente espalhado por desktop é risco
  sem dono.
- Fonte → Recomendação do engenheiro, alinhada à regra do projeto de não
  deixar dado de cliente fora do sistema.

**1.7**
- Decisão → A transcrição e o resumo da conversa são feitos **na nuvem,
  pelo Gemini** (o modelo de fala do Google), que recebe o áudio e
  devolve texto e resumo numa única ida. O resultado entra na Timeline
  como anotação da ligação.
- Fonte → Custo verificado: cerca de um centavo por ligação de dois
  minutos, contra algo perto de dez centavos por minuto nos serviços de
  transcrição dedicados. O Claude, que já usamos, não recebe áudio.

**1.8**
- Decisão → Telefonia entra como **módulo próprio na tela de Permissões**.
  Representante liga e ouve **as próprias** chamadas; gerente e
  administrador ouvem as da equipe.
- Fonte → Mesma regra de carteira já valendo para empresa, lead e tarefa.

**1.9**
- Decisão → Antes de discar, o CRM **arruma o número** (tira pontuação,
  completa o código do país, checa se tem DDD). Número incompleto mostra
  aviso na hora, em vez de gastar uma tentativa de chamada.
- Fonte → Recomendação do engenheiro — a base tem telefone digitado à mão
  de várias origens (planilha, Receita, eGestor, Meta).

**1.10**
- Decisão → O aviso de gravação é **falado pelo SDR na abertura da
  ligação** ("esta ligação é gravada para fins de qualidade"), e o CRM
  mostra a frase **do lado do botão de ligar**, para ninguém esquecer. O
  lembrete acompanha o SDR durante a chamada, na barra de ligação. Se a
  equipe crescer ou a disciplina falhar, migramos para o aviso automático
  da central da BR DID (R$ 11,90 por ramal/mês) sem refazer nada.
- Fonte → Decisão do usuário, 2026-09-23.

**1.11**
- Decisão → O cliente vê o **número fixo da Gama em Santa Maria**, que já
  existe. Se um dia quisermos aparecer com DDD da região do cliente,
  basta comprar números adicionais na BR DID (a partir de R$ 16,98/mês
  cada) — não muda nada do que vai ser construído agora.
- Fonte → Linha existente; preço confirmado na tabela da BR DID.

---

## Como vai ser construído, por etapa

**Etapa 1 — Discar pelo CRM e registrar sozinho**
- Botão "Ligar" nas fichas, o programa em segundo plano no PC do SDR, e o
  registro da chamada nascendo na Timeline ao desligar (com duração e se
  atendeu).
- Ao fim dela o SDR já trabalha o dia inteiro dentro do CRM.
- Esforço estimado: cerca de 4 dias de trabalho, incluindo a instalação
  na primeira máquina.

**Etapa 2 — Gravação e resultado**
- Áudio sobe para o CRM e fica na ficha; marcação do resultado (atendeu,
  não atendeu, caixa postal, número errado), e número errado passando a
  **corrigir o cadastro** em vez de só sumir.
- Esforço estimado: cerca de 3 dias.

**Etapa 3 — Transcrição e resumo automáticos**
- A conversa vira texto e resumo na Timeline, poucos minutos depois de
  desligar.
- Esforço estimado: cerca de 2 dias.

**Etapa 4 — Fila do dia e números da operação**
- Modo "fila": a partir de um filtro da Prospecção, o SDR percorre os
  leads ligando em série, sem voltar para a lista a cada chamada.
- Painel com ligações por representante, taxa de atendimento e tempo
  médio de conversa.
- Esforço estimado: cerca de 3 dias.

---

## Quanto custa

- **Linha BR DID** — já paga hoje. Minutos: a partir de R$ 0,07 para
  celular e R$ 0,03 para fixo. Um SDR ligando o dia inteiro (algo entre
  1.500 e 1.800 minutos/mês) fica em torno de R$ 120 a R$ 150/mês em
  minutos.
- **Transcrição e resumo** — cerca de R$ 0,01 por ligação de dois
  minutos; numa operação intensa, poucos reais por mês.
- **Nada mais.** Sem mensalidade por usuário, sem custo novo de servidor.
  Para comparar: a plataforma pronta que eu havia recomendado antes
  (API4COM) custaria R$ 169,90 por pessoa/mês — o caminho pela linha que
  já existe economiza isso, ao preço de instalar um programa em cada
  máquina.

---

## O que depende de você (fora do código)

1. **Trocar a senha da linha.** A senha da linha apareceu na imagem que
   você me mandou; qualquer pessoa com ela consegue fazer ligações pela
   conta da Gama. Use o botão "Gerar novas credenciais" no painel da BR
   DID e não me mande a nova por aqui — eu não preciso dela.
2. Liberar a instalação do MicroSIP e do programa de registro nas
   máquinas dos SDRs (Windows).
3. Dizer quantas pessoas vão ligar pelo CRM.

---

## Segurança

- A senha da linha telefônica fica **no computador do SDR e no painel da
  BR DID**, nunca no código do CRM nem no navegador.
- O programa que roda na máquina do SDR fala com o CRM usando uma
  credencial própria daquele usuário, que só permite registrar chamadas
  dele — não dá acesso a mais nada do sistema.
- A gravação é apagada do computador assim que sobe, e dentro do CRM só
  abre por link temporário, para quem tem permissão.
- O áudio enviado para transcrição vai só com o conteúdo da conversa, sem
  cadastro do cliente junto.

---

## Riscos conhecidos

- **Depende do computador do SDR.** PC desligado, programa fechado ou
  máquina nova sem instalação = ligação sem registro. Mitigação: o CRM
  mostra na tela quando não está conseguindo falar com o telefone da
  máquina, em vez de falhar calado.
- **Só Windows.** MicroSIP não tem versão para celular nem para Mac. Quem
  estiver na rua continua ligando do celular e registrando à mão, como
  hoje.
- **Qualidade de áudio** depende da internet e do headset. Fone com fio é
  requisito, não detalhe.
- **Marcação de spam** pelas operadoras se o volume de discagem crescer
  muito com um único número. Comprar mais números por DDD é o remédio
  conhecido.

---

## Para depois (não precisa responder agora)

- Receber ligação: o cliente liga de volta e a ficha dele abre sozinha na
  tela de quem atende.
- Discador automático, que liga sozinho para o próximo da fila.
- Botão de WhatsApp na mesma barra da ligação.
- Usar o resumo das conversas como matéria-prima do agente SDR.
