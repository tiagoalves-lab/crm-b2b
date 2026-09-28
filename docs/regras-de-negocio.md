# Regras de negócio — CRM B2B Gama Brasil

> **Como usar**: este é o documento raiz. Regra nova entra aqui primeiro,
> depois vira tarefa. Pergunta em aberto está marcada `❓ DÚVIDA` —
> responde direto embaixo dela, ou no chat.

---

## O propósito: isonomia entre as bases

O CRM não é mais um cadastro ao lado dos outros. Ele é o ponto onde as
bases se encontram, se comparam e se corrigem, para que **todas digam a
mesma coisa sobre a mesma empresa**.

Hoje ele coordena quatro fontes; Auvo e Orçamentos entram depois.

| Fonte | O que ela traz | O CRM escreve nela? |
|---|---|---|
| **eGestor Matriz** | clientes e faturamento | sim |
| **eGestor Filial** | clientes e faturamento | sim |
| **Receita Federal** (Cartão CNPJ) | cadastro oficial da empresa | não — só consulta |
| **Meta (Lead Ads)** | leads de formulário do Facebook/Instagram | não — só recebe |

**Nenhuma base manda por padrão.** Não existe hierarquia automática, nem
"a Matriz sempre vence", nem "o CRM sempre vence". O que existe é uma
regra de convergência que muda conforme o estado das bases — ver as duas
fases abaixo.

---

## Fase atual — convergência (a decisão é sua)

As bases ainda não estão iguais. Propagar mudança automaticamente agora
espalharia erro em vez de corrigir. Então:

**1.1**
- Decisão → O CRM **aponta** a divergência, não a resolve sozinho. Você
  abre Integração eGestor, analisa caso a caso e escolhe a direção da
  correção. A direção que você escolher é a verdade daquele registro.
- Fonte → Decisão do usuário, 2026-08-14.

**1.2**
- Decisão → Sua escolha grava em **todas as bases de uma vez** — CRM,
  Matriz e Filial (e Auvo, quando entrar). Corrigir só o eGestor e deixar
  o CRM para trás não resolve a divergência, só a esconde.
- Fonte → Decisão do usuário, 2026-08-14.

**1.3**
- Decisão → **Campo vazio na origem esvazia o destino.** Se você escolheu
  uma direção, os dois lados ficam iguais — inclusive quando isso
  significa apagar. Vazio deixou de ser "sem opinião" e passou a ser um
  valor como qualquer outro.
- Fonte → Decisão do usuário, 2026-08-14.
- Detalhe → Três exceções, em que branco continua significando "não sei":
  razão social (é a identidade do registro no ERP — empresa sem razão
  social no CRM é cadastro incompleto, não ordem de apagar o nome lá) e os
  campos fiscais da regra 4.1. Consulta à Receita que volta sem um campo
  também não apaga nada — só diz que a Receita não respondeu aquilo.
  E-mails e telefones são lista e se resolvem por "Consolidar".

**1.4**
- Decisão → Entre Matriz e Filial, a correção automática **continua
  ligada**: quem foi editado por último manda, e o CRM propaga para a
  outra conta. É o trabalho de convergência acontecendo sozinho, e não
  toca no CRM.
- Fonte → Decisão do usuário, 2026-08-13, mantida em 2026-08-14.

**1.5**
- Decisão → Nenhuma propagação envolvendo o CRM acontece sozinha — toda
  ela parte de uma ação sua. O webhook não grava no CRM enquanto durar
  esta fase.
- Fonte → Decisão do usuário, 2026-08-14.

**1.6**
- Decisão → **Salvar a ficha da empresa propaga para o eGestor.** Você
  corrige em Empresas > Dados cadastrais (ou Dados fiscais), salva, e o
  cadastro vai para a Matriz e a Filial no mesmo ato. É a via para
  corrigir empresa por empresa, ao lado da tela Integração eGestor.
- Fonte → Decisão do usuário, 2026-08-14.
- Detalhe → Empresa sem vínculo com o eGestor, ou cujos dados já batem,
  salva normalmente e não propaga nada. A mensagem de confirmação diz o
  que foi propagado e para onde.

**1.7**
- Decisão → **Quem propaga é quem tem permissão de editar cadastro**, não
  só administrador. Quem tem permissão apenas de Contatos edita o contato
  e não dispara nada no eGestor. A permissão diz o que a pessoa pode
  fazer; a carteira dela diz em quais empresas — ter a permissão não dá
  acesso à empresa de outro representante.
- Fonte → Decisão do usuário, 2026-08-14.

**O que encerra esta fase**: as bases estarem convergentes. A partir daí
vale a fase seguinte.

---

## Fase seguinte — isonomia (a propagação é automática)

Quando todas as bases estiverem alinhadas, o webhook passa a ser o braço
do CRM: qualquer mudança em qualquer base propaga sozinha para todas as
outras.

**2.1**
- Decisão → Cadastro criado em qualquer base nasce em todas. Exemplo:
  cliente cadastrado na Auvo aparece automaticamente no CRM, na Matriz e
  na Filial.
- Fonte → Decisão do usuário, 2026-08-14.

**2.2**
- Decisão → Alteração feita em qualquer base propaga para todas.
  Exemplo: a empresa mudou de sede — você corrige uma vez em Empresas >
  Dados cadastrais e Matriz, Filial e Auvo se atualizam. Se a correção
  vier da Matriz, o CRM grava nele mesmo e repassa para as outras.
- Fonte → Decisão do usuário, 2026-08-14.

**2.3**
- Decisão → Nesta fase o CRM **é gravável pelas outras bases**. A regra
  antiga de que o eGestor nunca sobrescreve o CRM depois da primeira
  importação deixa de valer — ela existia para proteger cadastro manual,
  e isonomia é o oposto disso.
- Fonte → Decorrência de 2.2.

---

## Como o dado entra no CRM

**3.1**
- Decisão → Do eGestor, por dois caminhos: **automático** (o eGestor avisa
  o CRM assim que alguém edita algo lá) e **manual** (botão "Sincronizar",
  que varre as duas contas inteiras).
- Fonte → Decisão do usuário, 2026-08-12.

**3.2**
- Decisão → Só entra quem é **cliente** no eGestor. Fornecedor puro fica
  de fora. Um contato pode ser as duas coisas — nesse caso entra.
- Fonte → Regra da API do eGestor, confirmada em teste.

**3.3**
- Decisão → Empresa que vem do eGestor nasce como **Cliente**, nunca passa
  pela triagem de leads. Se já é cliente no ERP, não é prospecção.
- Fonte → Decisão do usuário, 2026-08-07.

**3.4**
- Decisão → Lead do Meta entra na **Prospecção** (mesma esteira de
  qualquer outro lead: pontuação, classificação quente/morno/frio,
  "Aprovar para Lead"), sempre com um gerente como dono e com a tag
  **Meta Business**. O gerente distribui a partir daí; o lead nunca
  nasce sem dono. A pessoa que preencheu vira contato da empresa, e as
  respostas do formulário (equipamento, prazo, se já usa) entram como
  anotação na Timeline do lead.
- Fonte → Decisão do usuário, 2026-08-14 e 2026-09-04.

**3.5**
- Decisão → O **histórico de compras** de cada cliente vem do eGestor, das
  duas contas. Só entra venda de verdade — orçamento em aberto fica de
  fora, para não inflar o quanto o cliente já comprou. É esse histórico
  que alimenta o total comprado, a data da última compra e a aba
  Pós-venda; ele nunca vira negócio no Pipeline.
- Fonte → Decisão do usuário, 2026-08-07; carga executada em 2026-08-20.

**3.6**
- Decisão → Venda **cancelada** no eGestor sai do CRM. "Cancelada" ali
  quer dizer cadastro feito errado (digitação, duplicata), não devolução
  de mercadoria.
- Fonte → Decisão do usuário, 2026-08-07.

**3.7**
- Decisão → O **vendedor de cada venda** fica registrado na própria venda,
  e é reconhecido pelo e-mail que ele tem nos dois sistemas. Isso serve
  para relatório e comissão; **não muda quem enxerga qual empresa** — a
  carteira continua sendo decisão à parte. Vendedor do eGestor sem
  cadastro no CRM aparece nomeado no resumo da sincronização, e a venda
  entra do mesmo jeito, com o nome dele.
- Fonte → Decisão do usuário, 2026-08-20.
- Detalhe → As empresas trazidas do eGestor ficam **sem dono** de
  propósito. Dar dono a elas abriria a carteira inteira de clientes para
  o representante, o contrário da regra 3.8 — a ideia de mapear o
  vendedor da venda para o dono da empresa foi **descartada** pelo
  usuário em 2026-08-31.

**3.8**
- Decisão → A ficha da empresa tem três abas de faturamento: **Vendas**
  (código, estabelecimento, vendedor, data e total de cada compra),
  **ABC de Produtos** (o que ela mais compra, classificado A/B/C pelo peso
  em dinheiro) e **Serviços** (o que foi prestado a ela). Produto e
  serviço vêm separados do próprio eGestor.
- Fonte → Pedido do usuário, 2026-08-21.
- Detalhe → As três abas **não aparecem para representante**. É a única
  permissão que nasce desligada para esse papel; pode ser liberada membro
  a membro na tela de Permissões. A aba **Pós-venda** é assunto separado,
  e vai ser ligada na integração com a Auvo.

**3.9**
- Decisão → A lista de Empresas mostra a **classe da curva ABC** de cada
  cliente no lugar da antiga coluna Status (que só repetia o Tipo, sem
  informação própria). A é quem forma os primeiros 80% do faturamento
  acumulado, B os 15% seguintes, C o restante. Empresa sem compra fica
  **sem classe** — não é "classe D" nem é empurrada para C.
- Fonte → Pedido do usuário, 2026-08-21.
- Detalhe → A classe é **gravada por um cálculo explícito** (botão
  "Calcular curva ABC", só administrador), nunca recalculada ao abrir a
  tela: classe que muda sozinha a cada venda nova não serve para decidir
  prioridade de atendimento. A tela mostra a data da última apuração. A
  base do cálculo é a mesma do LTV — venda importada do eGestor mais
  oportunidade ganha no pipeline.

**3.10**
- Decisão → Cadastro de cliente feito no **app de cotações** entra direto
  no registro de Empresas, **sem tag nenhuma** — aparece com o selo Lead
  até ganhar a tag `cliente` pelo fluxo normal — e **não passa pela
  Prospecção**. O envio é estilo webhook (como o eGestor): o app de
  cotações não consulta antes de mandar; o CRM casa por CNPJ ao receber e,
  se a empresa já existe, devolve a existente sem duplicar e sem
  sobrescrever. A base de clientes das cotações vira espelho
  somente-leitura do CRM.
- Fonte → Decisão do usuário, 2026-08-28 (plano mestre em
  `gama-webapp/planejamento/integracao-crm.md`; doc técnico em
  `integracao-cotacoes.md`).

**3.11**
- Decisão → Enquanto o App do Meta não sai do modo desenvolvimento, os
  leads chegam pela **planilha do gestor de tráfego** (aba "Query CRM"),
  que avisa o CRM sozinha a cada linha nova, como o webhook do eGestor.
  A planilha é **só porta de entrada**: o CRM copia o lead na chegada e,
  dali em diante, a ficha vive no CRM. Alteração ou exclusão posterior
  na planilha não muda nada no CRM; cada lead entra uma única vez.
- Fonte → Decisão do usuário, 2026-09-04 (doc técnico em
  `webhook-meta-leads.md`).

**3.12**
- Decisão → Lead pode ficar na Prospecção **sem CNPJ** (o formulário do
  Meta nem sempre traz), mas **"Aprovar para Lead" exige CNPJ**. O
  vendedor preenche na ficha do lead durante a qualificação; ao digitar,
  o CRM consulta a Receita e completa razão social, CNAE, porte,
  situação e cidade, recalculando a pontuação.
- Fonte → Decisão do usuário, 2026-09-04.

**3.13**
- Decisão → Solicitação de proposta que chega pelo **Trello** vira
  oportunidade no funil pela tela do app de cotações. O botão ao lado do
  cartão diz o que dá pra fazer: **Cadastrar Oportunidade** quando o
  cartão ainda não tem card no CRM, **Ver Oportunidade** quando já tem.
  A oportunidade nasce em **Solicitação de Propostas**, com valor zero
  (ninguém cotou ainda), a empresa do cartão e a lista de itens do que o
  cliente pediu. Um cartão gera **um** card, para sempre: cadastrar de
  novo devolve o mesmo.
- Decisão → O **chat do cartão é espelhado** no chat do card, e o botão
  **Sincronizar** traz o que foi conversado depois. O espelho só
  acrescenta: mensagem já trazida não vem duas vezes, e nada do que foi
  escrito no CRM é apagado ou alterado. A mensagem mostra o nome de quem
  escreveu no Trello, marcada como vinda de fora — a pessoa não é usuária
  do CRM, então não vira autor de verdade.
- Decisão → O **representante da oportunidade sai do quadro do Trello**:
  cada representante tem o quadro dele, então é o quadro que diz de quem
  é a cotação. Quadro que não corresponde a nenhum membro (ou que
  corresponde a dois) não chuta: a oportunidade fica com o responsável
  padrão e se corrige no campo Representante do card.
- Fonte → Pedido do usuário, 2026-09-04 (plano mestre em
  `gama-webapp/planejamento/integracao-crm.md`, seção 6; doc técnico em
  `integracao-cotacoes.md`).

---

## O que o CRM nunca faz sozinho

**4.1**
- Decisão → Não inventa campo fiscal. Inscrição estadual, inscrição
  municipal e indicador de IE nascem no eGestor; o CRM **recebe e guarda**
  para ficar igual, mas nunca serve de origem para um campo fiscal que ele
  não tem.
- Fonte → Levantamento contra a produção: nenhuma das 1.166 empresas do
  CRM tem inscrição estadual preenchida — vazio ali significa "o CRM não
  sabe", não "a empresa não tem".

**4.2**
- Decisão → Não lança venda nem oportunidade no eGestor. Ao fechar uma
  oportunidade, o lançamento automático está **adiado** — quando retomar,
  testar com um registro real antes de ligar.
- Fonte → Decisão do usuário.

**4.3**
- Decisão → Não perde dado quando falha. Se o processamento automático
  quebra, o CRM devolve erro e deixa o eGestor reenviar o aviso (ele tenta
  até 5 vezes). No caso do Meta é o contrário: o CRM aceita e guarda o
  lead mesmo sem conseguir processar, porque a Meta descarta o aviso
  depois de 36 horas.
- Fonte → Diferença de comportamento das duas APIs, confirmada na
  documentação de cada uma.

**4.4**
- Decisão → Não ignora o eco da própria escrita. Quando o CRM corrige algo
  no eGestor, o eGestor devolve um aviso igual ao de uma edição humana —
  sem esse cuidado, o CRM reprocessaria o próprio trabalho em loop.
- Fonte → Confirmado contra a API real, 2026-08-12.

**4.5**
- Decisão → Não atropela ordem. Duas edições quase simultâneas no mesmo
  contato são aplicadas na ordem em que chegam, uma esperando a outra.
- Fonte → Decisão do usuário, 2026-08-13.

---

## Regras gerais do sistema

**5.1**
- Decisão → Ferramenta interna da Gama Brasil, uso colaborativo. Não é
  produto para vender a terceiros.
- Fonte → Decisão do usuário, 2026-07-24.

**5.2**
- Decisão → Em produção desde 2026-08-06. O dado antigo foi zerado; a
  carteira vem sendo reconstruída pela integração com o eGestor.
- Fonte → Decisão do usuário.

**5.3**
- Decisão → CNPJ é a chave que une tudo. Duas pessoas cadastrando a mesma
  empresa compartilham o registro; o perfil fica visível para as duas, mas
  histórico, tarefas, oportunidades e contatos continuam privados de quem
  os criou.
- Fonte → Decisão do usuário, 2026-08-06.

**5.4**
- Decisão → O card de oportunidade é um só: cadastrar e consultar usam a
  mesma tela (o formulário pequeno de "Nova oportunidade" foi removido).
  Na lateral do card fica a **lista de itens** — o que está sendo
  negociado —, e cada item vira uma **tag** que carimba os comentários do
  card e as tarefas geradas a partir dele. Só item da lista vira tag;
  remover um item não apaga o carimbo dos registros antigos.
- Fonte → Pedido do usuário, 2026-09-04.

**5.5**
- Decisão → O card de oportunidade **é** o formulário de edição: não
  existe mais botão "Editar" nem tela separada. Representante, valor,
  moeda, previsão e descrição são editados no próprio card e gravados no
  botão "Salvar". A **etapa** não aparece no card: quem move a
  oportunidade de etapa é o arrasto do cartão no quadro.
- Fonte → Pedido do usuário, 2026-09-04.

**5.6**
- Decisão → O card tem um campo de **descrição** longo, no molde da
  descrição do cartão do Trello: é onde se detalha o que está sendo
  negociado (modelo, opcionais, condições, prazos). Texto livre, sem
  formatação.
- Fonte → Pedido do usuário, 2026-09-04.

**5.7**
- Decisão → Cada item da lista lateral pode ter **valor**. Havendo
  qualquer item com valor, o **valor da oportunidade passa a ser a soma
  dos itens** — o campo Valor vira leitura e acompanha o total. Lista
  sem nenhum valor mantém o comportamento antigo: o valor é digitado à
  mão no card.
- Fonte → Pedido do usuário, 2026-09-04.

**5.8**
- Decisão → Anexo de oportunidade e de tarefa abre **prévia dentro do
  CRM** (imagem e PDF); os demais formatos oferecem baixar. O bloco de
  anexar é uma linha discreta — escolher o arquivo já dispara o envio.
- Fonte → Pedido do usuário, 2026-09-04.

**5.9**
- Decisão → Anexo do card de oportunidade tem **publicação**. Arquivo
  enviado por **administrador ou proprietário** entra reservado: só esses
  dois papéis enxergam, e um botão no anexo o **publica** para gerente e
  representante. Arquivo enviado por **gerente ou representante** já
  entra publicado. Publicar **não tem volta** — para tirar da vista,
  exclui-se o anexo e envia-se outro.
- Fonte → Pedido do usuário, 2026-09-15.

**5.10**
- Decisão → O calendário de Tarefas mostra, além das tarefas, as
  oportunidades do Pipeline **em Negociação e Fechamento**, no dia da
  **previsão de fechamento**. As das etapas de proposta ficam só no
  quadro; sem previsão, ganha ou perdida não aparece. O cartão diz
  **Pipeline** (não "Proposta", que é tipo de tarefa) e **arrasta igual
  tarefa**: soltar em outro dia muda a previsão de fechamento. Tarefa e
  oportunidade têm o **mesmo visual**, azul claro — atraso não muda a cor.
- Fonte → Pedido do usuário, 2026-09-16.

**5.11**
- Decisão → O **SLA da proposta é automático** e mede quanto tempo o time
  leva para concluir a proposta. Ninguém digita data: o campo Prazo SLA
  saiu das telas e é preenchido pelo sistema.
  - Enquanto o card está em **Solicitação, Elaboração ou Aprovação de
    Propostas**, o SLA está pendente e conta **até hoje**.
  - Ao mover o card para **Negociação e Fechamento**, o SLA **encerra** na
    data do movimento. Card cadastrado direto em Negociação nasce
    encerrado. Marcar como ganha, perdida ou reabrir **não mexe no SLA**:
    ele mede a conclusão da proposta, não o aceite ou a recusa do cliente.
  - Ao **voltar** um card de Negociação para uma etapa de proposta, abre
    uma janela para escolher o tratamento:
    - **Erro na elaboração da proposta** — não reinicia: a contagem segue
      desde o início até o novo encerramento.
    - **Solicitação de alteração pelo cliente** — reinicia: grava a
      **data de revisão** e a contagem passa a valer a partir dela.
    Cancelar a janela devolve o card para onde estava. A escolha fica no
    histórico do card.
  - O **selo de SLA** do card (Pipeline e e-mail) mostra os **dias úteis**
    (segunda a sexta, sem feriados) do início (data de revisão ou, sem
    ela, abertura) até o encerramento ou hoje.
  - Os e-mails (resumo diário e follow-up) listam as oportunidades **na
    mesma ordem do quadro** — a prioridade é gerenciada no Pipeline.
  - **Previsão de fechamento** continua livre para o representante
    organizar a negociação com o cliente.
  - As oportunidades que já existiam em 16/09/2026 foram recalculadas por
    esta regra (as datas digitadas à mão foram descartadas).
- Fonte → Pedido do usuário, 2026-09-16.

**5.12**
- Decisão → Toda exclusão feita pelas telas entra no **Registro de
  exclusões** (Administração): quem excluiu, quando, o tipo, o registro e
  uma **cópia do que foi apagado** — a tarefa leva junto comentários,
  checklist e anexos. A exclusão só acontece se o registro for gravado.
  Só administrador e proprietário veem a tela; ninguém altera nem apaga
  um registro. Exclusões automáticas da sincronização com o eGestor ficam
  de fora. Cobre as exclusões feitas a partir de 16/09/2026 — as anteriores
  não têm registro.
- Fonte → Pedido do usuário, 2026-09-16, depois de duas tarefas excluídas
  sem rastro.

**5.13**
- Decisão → Marcar uma oportunidade como **perdida** abre a janela **"Por
  que a negociação foi perdida?"**, no mesmo formato da janela de SLA: um
  botão por motivo, e clicar já confirma. Os motivos vêm de uma **lista
  única do CRM**; quem não achar o motivo usa **"+ Novo motivo"**, que o
  acrescenta à lista para todos (sem repetir motivo já existente).
  Administrador e proprietário mantêm a lista na aba **Motivos de perda**
  da Administração: cadastrar, **renomear** (as oportunidades já perdidas
  com o nome antigo passam a mostrar o novo) e **excluir** — só motivo que
  nenhuma oportunidade usou; a exclusão entra no Registro de exclusões.
  A lista existe para, com histórico,
  montar um **Pareto das perdas** — por isso não há motivo digitado solto.
  Lista inicial: Preço / concorrente, Demora no envio da proposta, Sem
  orçamento no momento, Prazo de entrega, Optou por terceirizar, Sem
  retorno / esfriou.
- Fonte → Pedido do usuário, 2026-09-17, depois de uma proposta recusada
  por demora no envio.

**5.14**
- Decisão → O menu lateral tem um item único **Administração**, que abre
  uma página em **abas** no molde das Configurações do eGestor: Membros,
  E-mail automático, Registro de exclusões, Integração eGestor e Motivos
  de perda. Cada papel vê só as abas a que tem acesso — gerente e
  representante veem apenas Membros.
- Fonte → Pedido do usuário, 2026-09-17.

**5.15**
- Decisão → Em **Últimas atividades** (Painel), do Pipeline só aparecem:
  **oportunidade criada**, **movida para Negociação e Fechamento**,
  **volta de Negociação** para uma etapa de proposta (aparece como
  "Solicitada alteração") e **marcada como fechada ou perdida** (com o
  motivo). Edição de campos, itens, troca entre etapas de proposta,
  exclusão e reabertura não aparecem ali — continuam no histórico do
  próprio card. Os demais módulos (tarefas, registros de contato,
  empresas, prospecção) não mudam.
- Fonte → Pedido do usuário, 2026-09-17.

**5.16**
- Decisão → O **Histórico de anotações** do Pipeline tem **marcar como
  lido**, no molde das notificações do Trello: uma bolinha em cada
  anotação (lida/não lida, clicando alterna), a opção **"Mostrar apenas
  não lidas"** e o botão **"Marcar tudo como lido"**. A marcação é **de
  cada pessoa** — ler não muda nada para os outros. Anotação escrita pela
  própria pessoa já nasce lida. As anotações que existiam em 17/09/2026
  começaram todas como não lidas. Quem entra na lista: o **representante**
  vê só as anotações dos cards dele; o **gerente**, as dos cards dele e da
  equipe (a mesma regra dos cards que ele abre); **administrador e
  proprietário** veem todas.
- Fonte → Pedido do usuário, 2026-09-17.

**5.17**
- Decisão → O cadastro de membros tem a marcação **Vendedor**. Só membro
  **ativo e marcado** aparece na lista **Representante** do card de
  oportunidade, e só para ele dá para trocar o representante. A marcação
  independe do papel. O representante atual de um card continua aparecendo
  nele mesmo sem a marcação, para o card não mudar de dono sozinho. Membro
  novo nasce desmarcado; os gerentes e representantes ativos em 17/09/2026
  começaram marcados.
- Fonte → Pedido do usuário, 2026-09-17.

**5.18**
- Decisão → A ficha da empresa na Prospecção tem a aba **Equipe de
  vendas**: a lista de quem trabalha aquela empresa, no mesmo formato da
  aba Contatos (barra de inclusão em cima, lista com Remover embaixo).
  Quem está na equipe enxerga a empresa e o lead dela na Prospecção;
  histórico, tarefas, contatos e oportunidades continuam privados de quem
  os criou (mesma regra 5.3). Mudar a equipe é de gerente para cima;
  representante vê a lista e não edita.
- Detalhe → Quem entra na equipe quando o prospect nasce:
  - **Cadastro manual** — o representante que cadastrou (responsável) e o
    **supervisor** dele. Representante sem supervisor cadastrado entra
    sozinho.
  - **Importação por planilha** — o representante escrito na coluna
    **Representante** (ou quem importou, se a coluna estiver vazia) e o
    supervisor dele. Se o CNPJ já existir no CRM, o dono original não
    muda: o representante da planilha entra na equipe.
  - **Importação do Meta** — vai para o gerente configurado como dono
    padrão dos leads do Meta (hoje o Arlei).
  - **Administrador e proprietário não entram na lista**: já enxergam
    todas as empresas pelo cargo.
  - O **responsável** não sai pela aba — trocar o dono da empresa é outra
    coisa.
- Detalhe → A equipe **nunca fica vazia**: toda empresa tem pelo menos um
  membro responsável por ela. Os 199 prospects que estavam sem ninguém
  (herdados da migração de empresas do eGestor para a Prospecção) ficaram
  com o **Arlei**, e todo representante sem supervisor passou a ter o
  Arlei como supervisor — ver `scripts/definir-arlei-supervisor-e-dono.ts`.
- Fonte → Pedido do usuário, 2026-09-21.

**5.19**
- Decisão → O modelo de planilha da Prospecção tem a coluna
  **Representante** e não tem mais **Sócios (QSA)** nem **Importador**.
  A coluna diz de quem é o lead: aceita o nome, o login ou o e-mail do
  membro, e em branco o lead fica com quem importou. Nome que não existe
  na equipe — ou que corresponde a dois membros — recusa só aquela
  empresa, com o motivo na linha; as outras entram normalmente.
- Detalhe → **Distribuir lead para outra pessoa é de gerente para cima**
  (gerente, administrador e proprietário). Representante comum importa
  sempre para a própria carteira, mesmo que escreva outro nome na coluna.
- Fonte → Pedido do usuário, 2026-09-23.

**5.20**
- Decisão → A tela de **Relatórios** segue o modelo do eGestor: menu de
  relatórios à esquerda, painel de filtros do relatório escolhido em cima
  e o resultado logo abaixo. Sem relatório escolhido, a área fica
  **vazia** — indicador de gestão é assunto do menu Painel, não daqui.
  Cada relatório gerado tem endereço próprio — dá para guardar nos
  favoritos do navegador e reabrir com os mesmos filtros.
- Fonte → Pedido do usuário, 2026-09-23.

**5.21**
- Decisão → Primeiro relatório: **Anotações da Timeline** — empresa,
  usuário, data, tipo e descrição, filtrado por período, tipo de
  anotação, usuário e empresa. Quando a mesma empresa tem vários
  registros do mesmo tipo dentro do período, eles entram **mesclados numa
  linha só** (dá para desligar no filtro). Cada pessoa só enxerga no
  relatório o que já enxergaria na Timeline da ficha — relatório não
  mostra o que a ficha esconde.
- Fonte → Pedido do usuário, 2026-09-23.

**5.22**
- Decisão → Segundo relatório: **Tarefas concluídas** — data da
  conclusão, empresa, responsável, tipo, tarefa e prazo, da última
  concluída para a mais antiga, filtrado por período, tipo, responsável e
  empresa. O período se refere à **data da conclusão**, não ao prazo, e
  tarefa reaberta deixa de contar como concluída.
- Fonte → Pedido do usuário, 2026-09-23.

---

## Processo comercial

**6.1**
- Decisão → A venda nasce por **dois caminhos**:
  - **Oportunidade pronta** — parte do cliente (recompra ou indicação de
    outra empresa): já entra como oportunidade e segue o fluxo do Pipeline.
  - **Prospecção ativa** — um **SDR** faz o contato e qualifica o lead
    pela **intenção de compra**. O objetivo desse caminho é **gerar novas
    oportunidades**, e é nele que está o foco estratégico do CRM.
- Fonte → Usuário, 2026-09-17, no mapeamento do processo comercial.

**6.2**
- Decisão → A abordagem do SDR tem **duas premissas**: obter (ou tentar
  obter) o contato do **tomador de decisão** e perguntar se a empresa tem
  **projeção de investimento em máquinas** e em que **período**. O SDR
  registra isso no CRM, e o período é o **critério de qualificação** — a
  classificação Curto/Médio/Longo Prazo que já existe na Prospecção:
  - **Curto Prazo — até 3 meses**: qualificado. Vira **oportunidade** e vai
    para o vendedor. É a "nova oportunidade gerada".
  - **Médio Prazo — 3 a 12 meses**: fica na Prospecção com **tarefa de
    retorno** criada automaticamente para a data do próximo contato.
  - **Longo Prazo — mais de 12 meses**: igual ao médio, com retorno mais
    distante.
  Lead sem classificação significa que o SDR ainda não trabalhou.
- Fonte → Usuário, 2026-09-17.

**6.3**
- Decisão → O **histórico de cotações de jul a set/2025** (planilha
  "Cotações", 123 linhas) vive no Pipeline como oportunidades:
  - **Valor** = coluna "Total Custos" da planilha.
  - **Item** = código do produto + modelo, em **texto livre**; o vínculo
    com o cadastro de produtos é da fase 2 (ver abaixo).
  - **Cliente** casado por **CNPJ**, não por razão social — no CRM os nomes
    estão abreviados e não batem.
  - **Representante** vinculado ao membro do CRM; os sete que faltavam
    foram cadastrados **sem e-mail**, ativos e marcados como Vendedor.
  - **Situação**: todas entraram **perdidas** com o motivo "Sem resultado
    registrado (histórico)", porque a máquina leva 3 a 4 meses entre
    aceite e nota e nada disso foi faturado em mais de um ano. Exceção
    confirmada: a cotação 14 (ORTOBRAS) entrou **ganha**, provada por duas
    notas de junho/2026.
  - Carga histórica **não gera registro em Últimas atividades**.
- Fonte → Usuário, 2026-09-18.

**6.4**
- Decisão → O faturamento da máquina sai em **NFS-e de serviço de
  instalação**, que não diz qual máquina foi — por isso o eGestor não
  responde "quais foram as últimas máquinas vendidas". Quem passa a
  responder é o **CRM**, pela oportunidade ganha e seu item. Cruzar
  cotação com nota por valor e data **não funciona** como regra automática:
  o valor da nota de serviço não corresponde ao da proposta.
- Fonte → Usuário, 2026-09-18.

**6.5**
- Decisão → A **fase 2** do histórico é outra: primeiro a planilha de
  cotações é importada **dentro do app de orçamentos**, depois o app é
  integrado ao CRM, e só então os itens das oportunidades são religados aos
  produtos cadastrados. É aí que nasce a gestão real do pipeline. Tem plano
  de migração próprio e não começa antes da fase 1 fechar.
- Fonte → Usuário, 2026-09-18.

**6.6**
- Decisão → **Prospecção é a casa do lead; Empresas é a casa do cliente.**
  - A tela **Prospecção** tem quatro abas: **Prospects** (ainda não
    qualificados — as etapas Entrada, Andamento e Reunião), **Leads
    qualificados** (as faixas Curto/Médio/Longo viram **sub-filtro** desta
    aba), **Leads convertidos** e **Descartados**.
  - **Leads convertidos** é a lista dos **leads do CRM que saíram da
    triagem**, com quantas propostas cada um tem em negociação, ganhas e
    perdidas, o valor em negociação e o último movimento. Conta só proposta
    do ciclo corrente: empresa que só tem cotação da carga histórica não
    entra aqui.
  - A tela chama-se **Carteira de clientes** e lista **só cliente**:
    o filtro Todas/Leads/Clientes e as colunas Tipo e Último contato saíram.
    As empresas que não são cliente saíram dali: as que têm proposta
    aparecem em **Leads convertidos** e as demais foram **levadas para a
    Prospecção como Prospects**, cada uma com o lead apontando para a
    empresa que já existia — nada duplicado, nada apagado.
  - A lista da Prospecção tem coluna **Representante** (o dono do lead);
    lead sem dono aparece como "sem dono".
  - O botão que tira o lead da triagem chama **Converter lead** (era
    "Aprovar para Lead") e, ao converter, oferece cadastrar a proposta na
    hora — é a proposta que coloca a empresa em Leads convertidos.
  - **Recuperação judicial** deixou de ser coluna na Prospecção e virou uma
    **bandeira** ao lado do nome da empresa.
- Fonte → Pedido do usuário, 2026-09-18.

**6.7**
- Decisão → O **Painel** mostra, em **metade da página cada**, o **Funil de
  vendas** (leitura de jornada) e o **Pipeline por etapa** (leitura
  operacional: uma barra por etapa com o valor em aberto). Em tela estreita
  os dois empilham.
- Fonte → Pedido do usuário, 2026-09-18.

**6.8**
- Decisão → O funil tem as **cinco etapas** da jornada —
  **Prospectar/Entrada**, **Andamento**, **Reunião**, **Qualificado** e
  **Negociação/Fechamento** —, cada uma com **o que entrou, o que está
  parado e o que saiu** (número + palavra dentro da pastilha; pastilha
  zerada não é desenhada), a **taxa de passagem** entre etapas, os
  **pedidos fechados** no fim e, embaixo, aproveitamento, perdas e valor
  perdido.
  Andamento e Reunião mostram **só o estoque**: não têm data de passagem
  própria, e número de movimento inventado ali seria pior que a ausência.
- Fonte → Usuário, 2026-09-23, ao reestruturar as etapas do funil.

**6.9**
- Decisão → O funil conta **só o ciclo comercial corrente**. Oportunidade
  nascida de carga entra marcada em `opportunity.origem` (hoje
  `historico-cotacoes`, as 123 cotações da decisão 6.3) e fica **fora do
  funil**, seguindo inteira no Pipeline e nos relatórios. Motivo: a carga
  não passou pela jornada do lead, e somá-la produzia número sem nexo — 26
  leads convertidos "gerando" 124 negócios fechados.
- Fonte → Usuário, 2026-09-18: "os leads convertidos estão sem nexo".

**6.10**
- Decisão → O funil **não credita passagem que não houve**. Só conta como
  "passou pela qualificação" o lead que tem **prazo registrado**; quem
  converteu sem prazo entrou pelo caminho da **oportunidade pronta**
  (decisão 6.1), e o funil diz isso em texto, com quantas propostas vieram
  direto do cliente sem passar pela Prospecção. Consequência prática: hoje
  a faixa Leads Qualificados aparece **vazia**, porque a qualificação do
  SDR ainda não começou a ser usada — e isso é a informação correta.
- Fonte → Usuário, 2026-09-18: "daonde aqueles 26 leads qualificados se nos
  prospects não tem nenhum?".

**6.11**
- Decisão → A etapa do funil é **régua única** em todo o CRM:
  Entrada, Andamento, Reunião, Qualificado, Negociação/Fechamento e
  Descartado (que não é etapa — é ter saído do funil). O quadro, a lista
  da Prospecção, a coluna **Funil** da Busca geral e o funil do Painel
  leem todos a **mesma coluna** do lead.
- Fonte → Pedido do usuário, 2026-09-18; etapas reestruturadas em
  2026-09-23.

**6.12**
- Decisão → **Lead convertido sem proposta cadastrada aparece em Leads
  convertidos**, com a conta zerada e o aviso "proposta ainda não
  cadastrada", e vem no topo da lista depois das negociações vivas — é
  fila que espera ação. Antes ele não estava em aba nenhuma: saía de
  Prospects ao ser convertido e não entrava em Leads convertidos, que só
  olhava o Pipeline.
- Fonte → Achado a partir do usuário, 2026-09-18, ao notar que a empresa
  aparecia na Busca geral e não aparecia dentro da Prospecção.

**6.13**
- Decisão → A busca do cabeçalho vale nas **quatro abas** da Prospecção
  (incluindo Leads convertidos, que antes não filtrava nada), a contagem
  de cada aba passa a ser **a dos resultados da busca**, e a aba aberta
  sem resultado **aponta a aba que tem** o registro.
- Fonte → Usuário, 2026-09-18: "no filtro geral a empresa consta no
  prospect, mas dentro do prospect o filtro não relaciona a empresa".

**6.14**
- Decisão → **Leads convertidos é lista de LEAD, não de empresa com
  proposta.** A base é o lead do CRM que saiu da triagem; empresa que só
  tem cotação da carga histórica sai dessa lista (eram 56 entrando como se
  fossem lead convertido, sem nunca ter sido lead — são cliente com
  histórico). A contagem de propostas por lead também olha **só o ciclo
  corrente**: cotação de 2025 não conta como negociação viva, então o lead
  aparece como "proposta ainda não cadastrada", que é a verdade. A carteira
  histórica segue inteira no Pipeline, nos relatórios e em Carteira de
  clientes.
- Fonte → Usuário, 2026-09-21: "os leads convertidos estão herdando a
  importação ainda, retratar somente registros do CRM".

**6.15**
- Decisão → Quem pula etapas não desaparece da leitura: o texto embaixo
  do funil diz **quantas propostas vieram de oportunidade pronta** (sem
  passar pela Prospecção), quantos convertidos ainda não têm proposta e
  quantas conversões são anteriores ao registro de datas.
- Fonte → Correção a partir do usuário, 2026-09-21.

**6.16**
- Decisão → A faixa **Leads Convertidos conta só quem tem proposta** —
  em negociação ou já com resultado. O nome da faixa é "Lead do CRM com
  proposta em andamento no Pipeline", então somar o convertido que nunca
  teve proposta cadastrada contradizia o próprio rótulo.
  Quem converteu e parou aí ganha uma **linha de aviso embaixo do funil**,
  com atalho para a Prospecção: é fila de ação, não estágio da jornada.
- Fonte → Usuário, 2026-09-21, ao pedir o novo texto da faixa.

**6.17**
- Decisão → O funil do Painel **mede movimento num período**, não estoque
  acumulado. Tem seletor de janela — 3 meses, 12 meses, este ano, tudo —
  e a janela padrão é **12 meses**, porque o ciclo da venda de máquina é
  de 9 a 12 meses e uma janela mensal mostra o funil zerado.
  A antiga "taxa de conversão" (ganhas ÷ todos os leads de todos os
  tempos) foi **apagada**: ela caía sozinha a cada lead importado. No
  lugar entrou **Aproveitamento** = propostas ganhas ÷ propostas que
  fecharam no período, que não se degrada com o crescimento da base.
- Fonte → Usuário, 2026-09-21: "o funil não deveria refletir dados sob a
  ótica de um período de tempo? senão ano que vem os dados estarão
  acumulados".

**6.18**
- Decisão → Cada faixa do funil mostra **três coisas separadas**, que
  antes estavam misturadas num número só:
  1. **quantos estão na faixa hoje** — número grande, é foto, sem período;
  2. **o movimento na janela** — entraram, avançaram, saíram;
  3. **a pendência da faixa**, com link para a tela já filtrada.
  A pendência é o que faz o funil apontar ação: fila sem prazo
  registrado, qualificado esperando proposta, convertido sem proposta
  cadastrada, proposta sem valor ou sem previsão de fechamento.
- Fonte → Usuário, 2026-09-21: "só quero que o funil seja funcional e
  direcione para alguma linha de ação; olhando para ele como está não sei
  o que fazer".

**6.19**
- Decisão → As passagens de faixa passam a ter **data gravada** no lead:
  `qualifiedAt` (recebeu prazo), `convertedAt` (saiu da triagem) e
  `discardedAt` (saiu do funil). Trocar Curto por Médio não requalifica —
  vale a primeira data; limpar a classificação limpa a data, porque sem
  prazo não houve qualificação.
  O passado fica **sem data de propósito** — inventar data falsearia a
  série. Só foi recuperado o que era rastreável: as conversões desde
  2026-08-20, quando a conversão passou a gerar registro na Timeline.
  Aparece como uma linha só embaixo do funil, fora do movimento.
- Fonte → Decorrência de 6.17: sem data de passagem não existe funil por
  período.

**6.20**
- Decisão → As etapas do funil de prospecção são
  **Prospectar/Entrada → Andamento → Reunião → Qualificado →
  Negociação/Fechamento**, e viraram um **campo próprio do lead** — antes
  a faixa era deduzida do par status + prazo, que só sabia representar
  três degraus e não tinha onde pendurar o meio do trabalho do SDR.
  O cartão anda sozinho quando o fato acontece:
  - **registrou qualquer contato** na Timeline → Andamento;
  - **registrou/agendou reunião** → Reunião;
  - **informou o prazo de investimento** → Qualificado;
  - **converteu o lead** → Negociação/Fechamento.
  O automático só empurra **para frente** (mais uma ligação não rebaixa
  quem já está qualificado); quem puxa para trás é a pessoa, arrastando no
  quadro. **Descartado não é etapa** — é ter saído do funil, tem aba
  própria, e o lead guarda a etapa em que parou.
  **Negociação/Fechamento não se alcança arrastando**: entra por
  "Converter lead", que exige CNPJ e cria a empresa.
- Fonte → Usuário, 2026-09-23: "preciso reestruturar as etapas do funil".

**6.21**
- Decisão → A Prospecção tem **duas visões da mesma informação**, trocadas
  por um par de ícones no canto da barra (lista e quadro), e a escolha
  **fica gravada no navegador** de quem usa:
  - **Lista** — a tabela de sempre, com as abas e as ações em lote.
  - **Quadro (Kanban)** — uma coluna por etapa do funil, cartão arrastável
    entre colunas. Cada coluna desenha 30 cartões por vez, com "Mostrar
    mais": a fila de entrada tem milhares de leads.
- Fonte → Usuário, 2026-09-23, apontando a tela de Tickets do Auvo como
  referência.

**6.22**
- Decisão → **Reunião tem data e hora.** Ao registrar uma reunião na
  Timeline, o CRM pede **data e horário** (Brasília) e, com eles
  preenchidos, cria sozinho a **tarefa da reunião** em Tarefas, com o
  contato, a empresa e o horário — é o que faz a reunião aparecer na
  agenda de quem marcou. Campo vazio = reunião que já aconteceu: registra
  o histórico e não cria tarefa.
  Em Tarefas, o prazo passa a ter **dois formatos**: tarefa do tipo
  Reunião pede data + hora; todo o resto continua sendo um dia só. Arrastar
  uma reunião no calendário **muda o dia e mantém o horário**.
  A tarefa de Reunião também registra **pessoas envolvidas**: os demais
  contatos da mesma empresa que participam, marcados além do contato
  principal. Só aparece no tipo Reunião; trocar o contato principal tira
  essa pessoa da lista de envolvidos.
- Fonte → Usuário, 2026-09-23: "ao agendar uma reunião inclua campo de
  data hora e coloque isso no tarefa menu de tarefas também"; 2026-09-24:
  "para a tarefa tipo reuniao crie campo para selecionar pessoas
  envolvidas".

**6.23**
- Decisão → **Cliente é quem já comprou** — pedido emitido no eGestor ou
  oportunidade ganha no Pipeline. Estar cadastrado como cliente no eGestor
  **não basta**: o ERP marca assim quem nunca comprou (145 cadastros em
  2026-09-18, todos levados para a Prospecção). A régua é a mesma na
  **Carteira de clientes**, na ficha da empresa e na busca geral.
  - Empresa criada por import de cotação, por conversão de lead ou na mão
    **não é cliente** enquanto não fechar nada: fica na Prospecção.
  - Empresa que já comprou **não é mais lead**: sai da fila de triagem e
    da seção Prospecção da busca, e aparece na Carteira de clientes.
  - O item de menu **Empresas** passou a se chamar **Carteira de clientes**.
  - A promoção de contatos do eGestor não tira mais da Prospecção quem
    ainda não comprou.
- Fonte → Usuário, 2026-09-18, ao achar a CRDC FERRAMENTARIA listada como
  empresa e como prospect na mesma busca: "se tem pedido e nota fiscal é
  cliente".

**6.24**
- Decisão → O filtro de **tags e segmentos** da Prospecção é um **botão
  "Filtros"** na barra, que abre uma janela de seleção com **caixas de
  marcar** — dá para escolher **quantas tags quiser**. As duas fileiras de
  pastilhas que ficavam em cima da tabela foram **apagadas**: com 27 tags
  elas tomavam três linhas da tela e só deixavam escolher uma por vez.
  - Com **mais de uma tag** marcada, a janela pergunta se é **qualquer uma
    delas** (padrão) ou **todas ao mesmo tempo**.
  - Cada opção mostra **quantos leads** ela traz, contados na Prospecção
    inteira — não muda conforme a seleção.
  - O botão mostra **quantos filtros estão valendo**, e as marcações ficam
    à vista abaixo da barra, cada uma removível num clique.
  - Filtrar **não recarrega a tela** e vale nas quatro abas **e no
    quadro** ao mesmo tempo.
- Fonte → Usuário, 2026-09-24: "vamos melhorar aqueles filtros de tags;
  crie um ícone que abra um modal para filtrar, inclusive mais de um".



## Perguntas para depois

Não precisa responder agora — ficam registradas para quando a integração
estiver estável.

- Que decisão gerencial você precisa tomar olhando o CRM e hoje toma no
  escuro?
- Se você abrisse o CRM uma vez por semana e olhasse uma coisa só, o que
  seria? (define o que é o Painel e o que é ruído)
- Prospecção e carteira de clientes são o mesmo funil ou dois mundos?
  Hoje o sistema trata como um só, mas o eGestor traz empresa já como
  cliente, por fora.
