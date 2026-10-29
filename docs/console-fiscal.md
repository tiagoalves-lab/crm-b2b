# Console fiscal

Módulo de conferência de notas fiscais dentro do CRM: PIS, COFINS, IPI,
ICMS e IR/CSLL trimestral, mais o controle de notas de remessa e retorno.
No CRM oficial desde 2026-10-22, depois de aprovado no endereço beta.

> **Como usar este arquivo**: toda dúvida minha que ainda não tem resposta
> está marcada com `❓ DÚVIDA`. Responde direto embaixo de cada uma (ou
> edita a linha), que eu releio antes de implementar. Itens já fechados
> entram na lista numerada.

## 1. Escopo e regime

**1.1**
- Decisão → A Gama é **Lucro Presumido**. PIS e COFINS são cumulativos
  (sem crédito de entrada) e IR/CSLL são apurados por trimestre sobre a
  receita, separando venda de mercadoria de prestação de serviço.
- Fonte → Decisão do usuário, perguntada direto (2026-10-20).

**1.2**
- Decisão → O trabalho vai por partes: primeiro as tabelas, depois a
  carga das notas emitidas, depois as notas recebidas, e só então o
  painel.
- Fonte → Decisão do usuário (2026-10-20).

## 2. De onde vêm as notas

**2.1**
- Decisão → Notas **emitidas** pela Gama (NF-e e NFS-e, Matriz e Filial)
  vêm da API do eGestor, uma conta de cada vez, e são guardadas juntas,
  com uma coluna dizendo o estabelecimento.
- Fonte → Decisão do usuário; API conferida em 2026-10-20 (NF-e: 658 na
  Matriz e 67 na Filial desde jan/2025; NFS-e: em 2026 quase só a Filial
  emite).

**2.2**
- Decisão → Nota que a própria Gama emite fica na tabela das emitidas
  **mesmo quando o CFOP é de entrada** (importação, retorno de remessa,
  devolução de cliente). A direção (entrada/saída) vem do próprio XML; a
  tabela já diz a origem.
- Fonte → Decisão do usuário (2026-10-20).

**2.3**
- Decisão → NF-e **recebidas** (emitidas por terceiros contra a Gama,
  Matriz e Filial) têm tabela própria (`fiscal_nfe_recebida` + itens),
  alimentada só pela API do eGestor, que já puxa da SEFAZ e entrega o XML
  completo — sem upload de XML. Mesma regra da 2.2: a origem (emitida ×
  recebida) vem do endpoint de onde a nota veio, nunca do conteúdo dela,
  e o conteúdo fica como está no arquivo, sem inverter — inclusive o
  **CFOP, que é o do fornecedor** (5102 = venda dele; a entrada da Gama,
  1102, não está no arquivo). A coluna de origem guarda a consulta do
  eGestor: `egestor:/v1/nfe` (NF-e emitida), `egestor:/v1/nfse` (NFS-e
  emitida) e `egestor:/v1/nfe/recebidas` (NF-e recebida).
- Fonte → Decisão do usuário (2026-10-21).

**2.3.1**
- Decisão → Nota recebida que o eGestor só tem em **resumo** (ninguém deu
  ciência da operação) entra assim mesmo, com fornecedor, data, valor e
  situação, mas sem itens e impostos, marcada "Só resumo" na tela. Dar
  ciência no eGestor libera o arquivo, e o CRM o traz sozinho na
  conferência de hora em hora (decisão 5.5). Nota que a Gama declarou
  desconhecida ou não realizada fica só em resumo pra sempre — essa não
  deve receber ciência.
- Fonte → Decisão do usuário (2026-10-21): com o endpoint funcionando,
  não precisa de upload.

**2.3.2**
- Decisão → Nota entre Matriz e Filial (mesma raiz de CNPJ no emitente e
  no destinatário) aparece como emitida de um lado e recebida do outro, e
  a tela marca "Transferência". O painel vai tratá-la como movimento
  interno, não como compra e venda.
- Fonte → Observado na carga de 2026-10-21 (27 transferências desde
  jan/2025).

**2.4**
- Decisão → A NFS-e não vem com arquivo pelo eGestor. Os dados da nota
  vêm da listagem de NFS-e, e os impostos (ISS, INSS, PIS, COFINS, CSLL,
  IRRF) vêm do relatório de impostos de NFS-e do eGestor.
- Fonte → Testado contra a API real (2026-10-20).

## 3. Como os dados são guardados

**3.1**
- Decisão → Tabelas com o prefixo `fiscal_` pra aparecerem
  juntas no Supabase: `fiscal_cfop`, `fiscal_nfe_emitida` (uma linha por
  nota), `fiscal_nfe_emitida_item` (uma linha por item),
  `fiscal_nfse_emitida`, `fiscal_nfe_recebida`, `fiscal_nfe_recebida_item`
  e `fiscal_remessa_vinculo` (vínculo remessa × retorno feito à mão,
  decisão 7.5).
- Fonte → Decisão do usuário (2026-10-20, 2026-10-21 e 2026-10-22).

**3.2**
- Decisão → O CFOP que manda é o **do item**, porque uma mesma nota pode
  misturar venda e remessa. Os totais da nota também ficam guardados
  exatamente como vêm no XML, o que permite conferir se a soma dos itens
  bate com o total. Visões prontas pro painel são montadas quando o
  painel precisar delas.
- Fonte → Decisão do usuário (2026-10-20).

**3.3**
- Decisão → Os nomes das colunas de valor seguem as tags do XML (vBC vira
  `v_bc`, vICMS vira `v_icms`), pra conferência direta contra o arquivo.
  O XML completo de cada NF-e fica guardado junto da nota.
- Fonte → Premissa do usuário de que os totais estão nas tags do XML.

**3.4**
- Decisão → Mês e trimestre de apuração usam a **data local da nota**
  (como está no XML), nunca o horário convertido pra outro fuso. Evita
  nota emitida à noite no último dia do mês cair no mês seguinte.
- Fonte → Bug real já corrigido em outras telas do CRM (fuso de
  Brasília).

## 4. Tabela de CFOP

**4.1**
- Decisão → A tabela de CFOP é a planilha ConfigCFOP do usuário, com as
  marcações Receita, Devolução, Remessa, Importação, Transferência,
  Devolução de venda, Devolução de compra e Retorno. É ela que os
  relatórios usam pra filtrar e pra casar remessa com retorno. Pode ser
  editada direto no Supabase.
- Fonte → Planilha do usuário, carregada em 2026-10-20: 591 códigos (o
  2652 aparecia duas vezes e entrou uma vez só).

**4.2**
- Decisão → Nota com CFOP que não está na tabela entra mesmo assim, e o
  painel mostra como "CFOP sem cadastro", em vez de a nota sumir.
- Fonte → Proteção contra perda de nota na conferência.

**4.3**
- Decisão → Na venda para entrega futura, a receita fica no **simples
  faturamento** (5922 e 6922). A remessa da mercadoria (5116, 5117, 6116
  e 6117) é marcada como Remessa, sem Receita, pra mesma venda não contar
  duas vezes. Não existe 7922 na tabela oficial de CFOP.
- Fonte → Decisão do usuário (2026-10-20).

**4.4**
- Decisão → A coluna **Exige retorno** separa a remessa que precisa
  voltar da que não volta. Só pode ser marcada em CFOP de remessa (o
  banco recusa o contrário). Marcadas hoje, nas versões 5 e 6 de cada
  código: venda fora do estabelecimento (5414, 5415, 5904, 5657), bem do
  ativo imobilizado pra uso fora (5554), armazenagem e depósito (5663,
  5905), industrialização por encomenda (5901), comodato (5908),
  demonstração (5912), exposição ou feira (5914), conserto (5915),
  consignação (5917) e vasilhame (5920). Não exigem retorno: entrega
  futura, bonificação, amostra grátis, remessas pra exportação, remessa
  por conta e ordem de terceiros e remessa simbólica.
- Fonte → Decisão do usuário pros exemplos (entrega futura, bonificação,
  amostra grátis, demonstração, conserto); classificação dos demais feita
  por mim em 2026-10-20, pela natureza de cada operação.

## 5. Atualização

**5.1**
- Decisão → A base tem **todo o histórico do eGestor**: NF-e emitidas
  desde ago/2022 (Matriz) e ago/2023 (Filial), NFS-e desde dez/2023
  (Matriz) e NF-e recebidas desde jul/2022. Antes disso o eGestor não tem
  nota. O Controle de remessas abre nos últimos 12 meses, com "Desde o
  início" no filtro.
- Fonte → Decisão do usuário (2026-10-20, carga desde jan/2025; ampliada
  pra todo o histórico em 2026-10-28).

**5.2**
- Decisão → Depois da carga, as NF-e emitidas se mantêm atualizadas pelo
  aviso automático do eGestor (webhook do módulo de NF-e): a cada aviso o
  CRM busca a nota atual no eGestor e grava; rascunho excluído sai da
  tabela. O aviso já estava ligado nas duas contas — quem não aceitava
  era o CRM.
- Fonte → Decisão do usuário (2026-10-20); implementado em 2026-10-21.
  Ver `docs/webhook-egestor.md`.

**5.3**
- Decisão → A NFS-e não tem aviso automático no eGestor, então ela é
  conferida automaticamente uma vez por dia, às 6h, a partir do 1º dia
  do mês anterior. A mesma rodada recupera qualquer aviso de NF-e que
  tenha se perdido.
- Fonte → Observado na API do eGestor (2026-10-20); implementado em
  2026-10-21.

**5.4**
- Decisão → A carga é **incremental**: rodar de novo só baixa nota nova,
  que mudou de situação (ex.: foi cancelada) ou que ficou sem XML. Nota
  cujo XML falhar entra assim mesmo, só com o resumo do eGestor, e é
  tentada de novo na próxima rodada. A primeira carga leva uns 15
  minutos (o eGestor libera uma chamada por segundo); as seguintes levam
  segundos.
- Fonte → Implementado em 2026-10-20. Disparo pela tela (botão
  "Atualizar notas", só owner/admin) ou pela linha de comando
  (`scripts/carregar-notas.ts`). Cobre emitidas e recebidas na mesma
  rodada.

**5.5**
- Decisão → As NF-e recebidas são conferidas **de hora em hora, das 7h
  às 19h, de segunda a sexta**, porque o eGestor não avisa quando chega
  nota recebida nem quando ela ganha o arquivo depois da ciência. A
  conferência olha a partir do 1º dia do mês anterior e também as notas
  mais antigas que ainda estão só em resumo, menos as que a Gama
  declarou desconhecidas ou não realizadas. Só aparece no histórico de
  requisições do eGestor quando grava ou falha alguma nota.
- Fonte → Decisão do usuário (2026-10-21). Testado contra a API real no
  mesmo dia: duas notas com ciência dada ganharam itens e impostos na
  primeira rodada, que levou menos de 30 segundos.

## 6. Segurança

**6.1**
- Decisão → As tabelas fiscais seguem o isolamento por workspace do
  resto do CRM, ninguém de fora do CRM lê elas pela chave pública do
  Supabase, e a tela só aparece pra quem tiver a permissão do módulo.
- Fonte → `docs/seguranca.md`, decisões 3.1 e 3.4. Conferido no banco e
  coberto pelo teste de vazamento entre workspaces em 2026-10-20.

**6.2**
- Decisão → A permissão **Console fiscal** (tela de Permissões do membro)
  tem "Ver" e "Editar". "Editar" é ligar e desfazer o retorno de uma
  remessa (decisão 7.5). As duas nascem desligadas pra gerente,
  representante e leitura, e ligadas pro administrador. É o único módulo
  em que o administrador segue a caixa: dá pra tirar o acesso de um
  administrador específico. Só o dono vê sempre. Quem não tem o console
  não liga nem desliga essa caixa em ninguém, e só o dono promove alguém
  a dono (senão um administrador sem o console se promoveria pra ver).
- Fonte → Faturamento e imposto são informação de gestão (mesmo critério
  das abas de vendas da ficha da empresa). "Editar" entrou em 2026-10-22
  junto com o vínculo à mão. Caixa valendo pro administrador: decisão do
  usuário (2026-10-22), "alguns admins não podem ter acesso ao console".

## 7. Relatórios

**7.1**
- Decisão → O console fiscal tem as telas em abas no topo e a tela
  escolhida embaixo, na largura toda, com a estética do CRM.
- Fonte → Decisão do usuário (2026-10-21): relatório no molde do eGestor
  com a estética do CRM. As abas substituíram o menu à esquerda em
  2026-10-22, quando o Controle de remessas ganhou as colunas de item e
  passou a precisar da largura toda.

**7.2**
- Decisão → O relatório **Resumo de notas emitidas** é a base do PIS e
  da COFINS. Ele junta as NF-e que têm item com CFOP marcado Receita e
  todas as NFS-e (serviço é sempre receita), com as colunas do "Resumo
  NFe" do eGestor mais Estabelecimento, Tipo (produto ou serviço) e ISS
  (só da NFS-e). Remessa, transferência e retorno ficam de fora. Filtros:
  período, estabelecimento, tipo, situação, operação e **Notas** — "Só
  receita" (padrão) ou "Todas as emitidas", que traz toda NF-e emitida
  (transferência, remessa, retorno, importação, complemento…) pra fechar
  com a lista de NF-e do eGestor. Sem filtro de situação, a
  nota cancelada aparece na lista mas não entra nos totais; filtrando
  "Canceladas", os totais somam as canceladas. Os valores são os do
  total da nota; NF-e que misturar CFOP de receita com outro vem marcada
  "CFOP misto" pra conferência à mão (nenhuma até 2026-10-21). Valor
  zerado aparece como R$ 0,00 (igual ao eGestor) e "—" fica só pro
  imposto que não se aplica à nota.
- Fonte → Decisão do usuário (2026-10-21). Conferido contra o "Resumo
  NFe" do eGestor de setembro/2026: as 10 notas comparadas bateram nos
  centavos, e as de demonstração, transferência e conserto ficaram de
  fora. O filtro "Todas as emitidas" veio do usuário em 2026-10-27, ao
  conferir a Matriz de outubro com a lista do eGestor: 30 notas e o
  mesmo total nos centavos.

**7.3**
- Decisão → O ISS das NFS-e da Filial aparece zerado porque o eGestor
  grava a nota com alíquota de ISS zero, embora o documento da nota saia
  com o ISS certo. Fica como está: o CRM mostra o que o eGestor tem.
- Fonte → Decisão do usuário (2026-10-21), que já conhecia a diferença
  no próprio eGestor. Conferido na API: as NFS-e da Filial de 2026 vêm
  com ISS de alíquota, base e valor zerados (só 4 de 127 com ISS).

**7.4**
- Decisão → O **Controle de remessas** mostra as notas com item de CFOP
  marcado "Exige retorno" nos dois sentidos: as que a Gama **enviou** e
  têm que voltar, e as que a Gama **recebeu** de terceiro (o CFOP é o do
  remetente) e tem que devolver. O retorno é a nota com CFOP marcado
  "Retorno". A remessa fica "Retornada" quando os retornos ligados a ela
  cobrem o valor, "Parcial" quando não cobrem, e "Em aberto", com os dias
  desde a remessa, quando não tem retorno ligado. A tela abre em todas as
  remessas desde o começo da base, com cards no topo: o total do período
  e cada situação, com quantidade, valor e a divisão entre remessa de
  saída e de entrada. Só entram notas autorizadas: remessa ou retorno
  cancelado, inutilizado ou denegado não aparece e não fecha remessa.
- Fonte → Pedido do usuário (2026-10-21). Na carga do mesmo dia: 54
  remessas casaram pela chave (46 com valor exato). Só autorizadas:
  pedido do usuário (2026-10-23); conferido no mesmo dia que a situação
  gravada no CRM bate com a do eGestor em todas as notas.

**7.5**
- Decisão → A tela tem o formato da planilha de controle do usuário: a
  remessa à esquerda (Data, NF, Tipo NF, Empresa, CFOP, Operação,
  Estabelecimento, Item, Valor) e o retorno ao lado (Data, NF, CFOP,
  Item, Valor), em branco enquanto não houver vínculo. O Item mostra os
  itens do CFOP de remessa (ou de retorno), com a quantidade na frente
  quando não é 1; os que não cabem ficam na dica do mouse. Numa coluna à direita ficam as
  notas de retorno do período, e quem tem "Editar" (decisão 6.2) liga uma
  delas à remessa **arrastando** a nota até a linha. Quando a própria
  nota de retorno cita a remessa, o vínculo já vem preenchido. Qualquer
  vínculo, inclusive esse automático, pode ser desfeito pelo "×" da
  linha. Um retorno pode fechar várias remessas e uma remessa pode voltar
  em várias notas. O CRM recusa ligar retorno do sentido errado: a
  remessa que a Gama enviou volta com nota de entrada da Gama ou com a
  nota de saída do cliente, e a que a Gama recebeu volta com nota de
  saída da Gama ou com a nota de entrada do próprio dono (ex.: CFOP 2916).
- Fonte → Decisão do usuário (2026-10-22): o eGestor não guarda essa
  ligação, então ela fica gravada no CRM (`fiscal_remessa_vinculo`, com
  quem fez e quando). A marcação "Provável" (retorno da mesma empresa que
  não cita a remessa) deixou de existir. Na base de 2026-10-22, 59
  vínculos vieram prontos das próprias notas e 22 notas de retorno
  ficaram pra ligar à mão.

**7.6**
- Decisão → Nota com CFOP errado também entra no controle quando a
  descrição da operação diz remessa ou retorno de um tipo que volta
  (demonstração, conserto/reparo, comodato, exposição/feira,
  industrialização, consignação). Bonificação, amostra e garantia ficam
  de fora. Um acervo de regras de validação marca a linha com um "!"
  vermelho e alimenta o card **Alertas**, acima da tabela, onde cada
  regra mostra quantas remessas pega e filtra a tabela com um clique.
  Regras de hoje: CFOP da remessa não confere; remessa da Gama contada
  como receita (CFOP de venda); CFOP do retorno não confere; retorno maior
  que a remessa; retorno com data anterior à remessa; retorno de outra
  empresa (CNPJ comparado pela raiz). Regra nova entra no acervo e já
  aparece no card. A tabela também filtra por empresa e item, na hora.
- Fonte → Pedido do usuário (2026-10-26), depois de duas remessas de
  demonstração emitidas com CFOP de venda e um retorno de comodato com
  CFOP de entrada em comodato sumirem do controle. Na base do mesmo dia,
  4 notas entraram pela descrição.

**7.7**
- Decisão → Alerta pode ser marcado como **tratado**, com uma observação
  obrigatória do que foi feito, e reaberto depois. Tratado sai do radar:
  não conta no card, a linha perde o vermelho e o sinal vira um "✓"
  cinza; o card ganha o filtro "Tratados". O clique no sinal da linha
  abre os alertas da remessa com o botão de tratar/reabrir e o
  **histórico** (quem, quando, o quê e a observação). Cada ação é uma
  linha nova em `fiscal_remessa_alerta_log`, que não se edita nem se
  apaga (o banco só deixa ler e inserir); vale o último registro da
  remessa + regra. Tratar e reabrir exigem "Editar" no módulo fiscal.
- Fonte → Pedido do usuário (2026-10-26): sem isso o alerta ficaria
  sempre no radar; log pedido junto.

**7.8**
- Decisão → A tela **Notas de entrada** mostra as NF-e recebidas
  autorizadas e as NF-e de entrada que a própria Gama emite (importação,
  devolução, retorno), e cada **item** recebe uma classificação, na lista
  da planilha de controle do usuário, em grupos: Compra (Revenda,
  Industrialização, Mat. aplicado em serviço, Imobilizado), Despesa (Uso e
  consumo, Viagem), Sem compra (Remessa, Retorno, Transferência,
  Devolução, Crédito de ICMS) e Problema (Cancelada, Desconhecimento). Na
  linha, a classificação vale pra nota inteira; na ficha lateral, item a
  item, com NCM, base, alíquota e valor de ICMS e de IPI. A coluna "No
  eGestor" diz se a recebida foi lançada como compra (nota própria aparece
  como tal). Item sem classificação recebe sugestão — pelo CFOP (marcações
  da tabela de CFOP: transferência, devolução, retorno, remessa; 5601/6601
  = crédito de ICMS) ou, sem isso, pela classe mais usada nas notas do
  mesmo fornecedor — e a pessoa confirma. Classificar exige "Editar" no
  módulo fiscal. Cada mudança é uma linha nova em
  `fiscal_entrada_classificacao` (quem, quando, observação), que não se
  edita nem se apaga; vale o último registro do item.
- Fonte → Pedido do usuário (2026-10-26): no eGestor essas notas não são
  lançadas, ou são lançadas só em parte. A classificação de fevereiro a
  maio e de julho a setembro/2026 veio das planilhas mensais do usuário
  (coluna "Aplicação"), por `scripts/importar-classificacao-entradas.ts`:
  839 itens de 327 notas, todas achadas no CRM com o CFOP conferido item a
  item (junho ainda sem planilha). "Crédito
  de ICMS" não estava na lista da planilha, mas aparece nela (nota de
  transferência de saldo credor).

**7.9**
- Decisão → O botão **Imprimir / PDF** do Controle de remessas abre, em
  outra aba, a versão pra imprimir ou salvar em PDF e mandar pra
  contabilidade: folha A4 deitada, sem menu, com os mesmos filtros da
  tela (inclusive empresa e item). Leva o cabeçalho com período, filtros,
  data e quem gerou; um resumo por situação (saída, entrada, total, já
  retornado e saldo a retornar), contado das linhas impressas; e a
  tabela remessa × retorno com o CNPJ da empresa e todos os itens, com o
  cabeçalho repetido em cada página e o total no fim. Alertas não saem
  na impressão. O PDF sai pelo "Salvar como PDF" do navegador
  (`/impressao/remessas`).
- Fonte → Pedido do usuário (2026-10-26).

**7.10**
- Decisão → A aba **Consultar notas** pesquisa em todas as notas da base
  (NF-e emitidas, NF-e recebidas e NFS-e). Na barra ficam só Período (um
  campo, com atalhos e a escolha de um mês), Empresa (nome ou CNPJ, a raiz
  traz as filiais), Número e Item (descrição ou código); o resto fica na
  janela **Mais filtros**, aberta pelo ícone ao lado: documento, situação
  (inclusive "Só resumo"), série, chave, origem (entrada/saída), quem
  emitiu, estabelecimento, transferência, UF, NCM, código de serviço,
  classificação da entrada, CFOP (código ou faixa, "59xx"), marcação da
  tabela de CFOP, faixa de valor da nota e do item e imposto destacado.
  O resultado sai **por nota** (com ICMS, IPI, PIS e COFINS), **por item**
  (com origem da mercadoria, CST, base, alíquota e valor de ICMS e IPI),
  ou somado por empresa, CFOP ou mês, e exporta em planilha. **Origem**
  é do ponto de vista da Gama: a venda do fornecedor aparece como entrada
  (a tabela continua guardando o XML como veio, decisão 2.3). Cancelada
  aparece mas não soma (mesma regra da 7.2). Rascunho e nota recusada
  ficam de fora.
- Fonte → Pedido do usuário (2026-10-28), modelo aprovado no mesmo dia e
  publicado direto em produção a pedido dele.

## Pra depois (não precisa responder agora)

- Devolução de venda (CFOP marcado Devolução de venda) ainda não abate a
  receita no relatório 7.2.
- Notas de entrada (7.8): o eGestor só diz se a nota virou compra (sim ou
  não); "lançada em parte" exige comparar os itens da compra com os da
  nota.
- Prazo de retorno por tipo de remessa (demonstração, conserto, feira…):
  hoje o controle mostra só os dias em aberto, sem dizer se venceu.
- Remessa recebida que o eGestor só tem em resumo (sem ciência) não tem
  itens, então não aparece no controle até chegar o arquivo.

- O 5151 está sem descrição na planilha e sem a marcação de
  Transferência, que o 6151 tem.
- O 6551 (venda de ativo imobilizado) está marcado como Receita e o 5551
  não. A Gama usou o 5551 em 2 notas.
- NFS-e de serviços tomados: possível pelo Ambiente Nacional da NFS-e
  (ADN), mas exige instalar o certificado digital A1 da Gama no servidor
  e só cobre prefeituras no padrão nacional (obrigatório desde 2026).
  Etapa própria, com decisão de segurança à parte.
