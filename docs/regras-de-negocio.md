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
  "Aprovar para Lead"), sempre com um gerente como dono. O gerente
  distribui a partir daí; o lead nunca nasce sem dono.
- Fonte → Decisão do usuário, 2026-08-14.

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

---

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
