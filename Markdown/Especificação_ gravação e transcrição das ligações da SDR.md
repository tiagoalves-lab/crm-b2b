Especificação: gravação e transcrição das
ligações da SDR
24 de out. de 2026 · @Someone
Decisão: onde gravar e por quê
Gravar no MicroSIP, no PC da SDR, e subir o arquivo pelo agente da Gama; contratar
também a gravação de 30 dias da BR DID (R$ 9,90/mês) como contraprova e reserva.
Opção Prós Contras
MicroSIP + agente (principal) Gratuito; gravação automática com data, hora e Depende do PC e do agente estarem funcionando
número no nome do arquivo; áudio dos dois lados; (ver correção da falha de 21 e 22/10)
o encaixe com a ligação do CRM é feito pelo
agente que já conhece a chamada; áudio
disponível segundos após desligar
Gravação na BR DID (reserva) Independe do PC; serve de contraprova quando o R$ 9,90/mês; sem confirmação de API para
CRM não registrar download; sem id da chamada no CRM para casar,
só número e horário
Trocar o softphone por cliente web no CRM Controle total, sem agente Projeto maior; exige SIP sobre WebSocket na BR
DID, não confirmado
O MicroSIP já é o softphone em uso, então não há troca de ferramenta para a SDR.
Fluxo ponta a ponta
O áudio sai do MicroSIP e volta ao CRM como transcrição e resumo
1. MicroSIP (PC da SDR) 2. Agente da Gama 3. Supabase Storage
grava a chamada em MP3 na pasta casa o arquivo com a ligação e envia bucket privado gravacoes

6. Painel e cobrança 5. CRM: call_recordings 4. Edge Function transcrever
decisor, interesse, próximo passo transcrição, resumo, desfecho, nota Whisper + resumo em JSON
Reserva: gravação de 30 dias na BR DID, casada por número e horário quando o agente falhar.
Cada etapa só depende da anterior ter deixado um arquivo ou um registro; se o agente
parar, os arquivos ficam na pasta e são enviados quando ele voltar.
Configuração do MicroSIP
No MicroSIP, em Configurações, ativar a gravação automática de chamadas e fixar a pasta
de saída.
1. Gravação de chamadas: ligar a opção de gravar automaticamente todas as chamadas.
2. Pasta de gravação: uma pasta fixa, fora de Downloads e fora de sincronização de
nuvem (ex.: C:\Gama\gravacoes ). O agente lê essa pasta.
3. Formato: MP3 (menor; a transcrição aceita MP3 e WAV).
4. Nome do arquivo: o MicroSIP grava data, hora e número discado no nome. Conferir o
padrão exato na primeira gravação e fixar no agente a expressão que extrai os três
campos.
5. O MicroSIP só gera arquivo para chamada conectada; chamada não atendida não gera
gravação, o que é o esperado.
Ponto a verificar na primeira semana: se a gravação traz os dois lados em volume
parecido. Se o lado remoto vier baixo, ajustar o ganho do áudio no MicroSIP antes de ligar
a transcrição em escala.
Agente no PC da SDR
O agente que hoje registra as ligações ganha três responsabilidades: vigiar a pasta de
gravações, enviar cada arquivo vinculado à ligação certa e provar que está vivo.

Envio das gravações
1. Vigiar a pasta de gravações (evento de arquivo novo e varredura a cada 60 s, para
pegar o que o evento perdeu).
2. Esperar o arquivo parar de crescer (tamanho estável por 5 s): o MicroSIP só fecha o
arquivo ao desligar.
3. Extrair do nome do arquivo data, hora e número. Casar com a ligação em calls :
mesmo user_id , últimos 8 dígitos do telefone iguais, atendida_em (ou
iniciada_em ) dentro de 3 minutos do horário do arquivo. Mais de uma candidata: a
de horário mais próximo. Nenhuma: enviar mesmo assim com call_id nulo e marcar
status = 'sem_ligacao' para conferir depois.
4. Enviar para o bucket gravacoes em {workspace_id}/{ano}/{mes}/{call_id ou
sem-ligacao}/{nome do arquivo} e inserir a linha em call_recordings (campos na
seção Supabase).
5. Só depois de confirmado o insert, mover o arquivo local para a subpasta enviadas/ .
Falhou: manter na pasta e tentar de novo na próxima varredura; a fila é o próprio
sistema de arquivos.
6. Apagar de enviadas/ o que tiver mais de 7 dias.
Correção da falha de registro (21 e 22/10)
Nesses dias a BR DID mostra 32 ligações completadas por dia e o CRM registrou 5 a 6; o
agente parou sem ninguém perceber. telefonia_dispositivos.ultimo_uso_em está
parado em 28/09, então o campo não está sendo atualizado.
1. Heartbeat: a cada 5 minutos o agente atualiza
telefonia_dispositivos.ultimo_uso_em .
2. Alerta: uma rotina no Supabase (pg_cron) verifica, em dia útil das 8h às 18h,
dispositivos ativos sem heartbeat há mais de 15 minutos e grava um aviso visível no
CRM e no painel.
3. Início automático: o agente entra com o Windows e reinicia sozinho se cair (serviço do
Windows ou Agendador de Tarefas com repetição).
4. Log local com rotação em C:\Gama\agente\logs , para diagnosticar a próxima falha.
5 Diagnósticopendente abrirologdoagentede21/10e eroq eacontece entre

5. Diagnóstico pendente: abrir o log do agente de 21/10 e ver o que aconteceu entre
8h55 (primeira ligação na BR DID) e a última registrada no CRM.
Reconciliação com a BR DID (mensal ou quando houver suspeita)
Importar o CSV de chamadas da BR DID e casar com   por número e horário (janela
calls
de 3 minutos), como feito em 24/10: ligações da operadora sem par no CRM indicam falha
do agente, não ausência de discagem.
Supabase: bucket, migration e função de transcrição
Tudo entra pelo projeto do CRM (migration do Prisma e função versionada), nunca direto
no painel do Supabase, para não conflitar com as 74 migrations existentes.
Bucket  gravacoes  (privado): o áudio existe só para ser transcrito. Escrita pelo agente
(service role ou token do dispositivo); leitura apenas pela função de transcrição;
nenhuma tela do CRM exibe ou reproduz o áudio, e não há URL de acesso para usuários.
Migration Prisma: tabela   (separada de  , porque uma ligação
call_recordings calls
pode ter mais de uma fonte de áudio e a transcrição tem ciclo de vida próprio):
| Campo        | Tipo                  | Observação                             |
| ------------ | --------------------- | -------------------------------------- |
| id           | uuid                  | chave                                  |
| workspace_id | uuid                  | FK workspaces                          |
| call_id      | uuid, nulo            | FK calls; nulo quando não casou        |
| user_id      | uuid                  | quem ligou                             |
| origem       | enum: microsip, brdid | fonte do áudio                         |
| storage_path | text                  | caminho no bucket                      |
| arquivo_nome | text                  | nome original (tem data, hora, número) |
| telefone     | text                  | número extraído do nome                |
| gravado_em   | timestamp             | horário extraído do nome               |

| duracao_segundos | int |     |     |     |     | do áudio |     |
| ---------------- | --- | --- | --- | --- | --- | -------- | --- |
status enum: enviada, transcrevendo, transcrita, erro,  ciclo de vida
sem_ligacao
transcricao text texto completo, com marcação de falante quando
o serviço der
| resumo        | jsonb     |                        |     |          |                                     | formato fixo (seção seguinte) |     |
| ------------- | --------- | ---------------------- | --- | -------- | ----------------------------------- | ----------------------------- | --- |
| modelo        | text      |                        |     |          |                                     | serviço e modelo usados       |     |
| custo_usd     | numeric   |                        |     |          |                                     | para acompanhar gasto         |     |
| erro          | text      |                        |     |          |                                     | última falha                  |     |
| transcrito_em | timestamp |                        |     |          |                                     |                               |     |
| criado_em     | timestamp |                        |     |          |                                     |                               |     |
|               | Em        | , só uma coluna nova:  |     |          |  (enum: nao_atendeu, caixa_postal,  |                               |     |
|               | calls     |                        |     | desfecho |                                     |                               |     |
numero_invalido, empresa_encerrada, falou_terceiro, falou_decisor, sem_interesse,
interesse, retornar), preenchida pela SDR ao encerrar e, quando houver transcrição,
sugerida pelo resumo. É o campo estruturado que o relatório de 24/10 apontou como
ausente.
|     | Edge Function   |                          | transcrever              | , disparada por Database Webhook no insert em  |     |     |     |
| --- | --------------- | ------------------------ | ------------------------ | ---------------------------------------------- | --- | --- | --- |
|     | call_recordings |                          |  com  status = 'enviada' |                                                | :   |     |     |
|     | 1. Marca        | status = 'transcrevendo' |                          |                                                | .   |     |     |
2. Baixa o áudio do bucket por URL assinada.
|     | 3. Transcreve em português. Primeira escolha: OpenAI ( |     |     |     |     | gpt-4o-transcribe |  ou  |
| --- | ------------------------------------------------------ | --- | --- | --- | --- | ----------------- | ---- |
whisper-1 ); alternativa: Deepgram Nova com diarização, se a separação de falantes
|     | for importante. Guardar o texto em  |     |     |     | transcricao | .   |     |
| --- | ----------------------------------- | --- | --- | --- | ----------- | --- | --- |
4. Gera o resumo com um modelo de linguagem (Claude Haiku ou GPT-4o mini) a partir
da transcrição, com saída em JSON no formato da seção seguinte. Guardar em
|     | resumo | .   |     |     |     |     |     |
| --- | ------ | --- | --- | --- | --- | --- | --- |
5. Grava uma atividade   na empresa e na ligação com o resumo em texto corrido (é
note

|     |     |     | p   | g ç |     |     | (   |
| --- | --- | --- | --- | --- | --- | --- | --- |
o que aparece no histórico do CRM hoje).
| 6. Se  calls.desfecho |                       |  estiver vazio, preenche com  |               | resumo.desfecho_sugerido                 |           | .          |     |
| --------------------- | --------------------- | ----------------------------- | ------------- | ---------------------------------------- | --------- | ---------- | --- |
| 7. Marca              |                       |                               | ,             | ,                                        | ,         | . Erro em  |     |
|                       | status = 'transcrita' |                               | transcrito_em | modelo                                   | custo_usd |            |     |
| qualquer passo:       |                       | status = 'erro'               | ,  erro       |  com a mensagem, e nova tentativa até 3  |           |            |     |
vezes com intervalo crescente.
Segredos (chaves da OpenAI/Deepgram) ficam nos secrets da função, nunca no agente
nem no front.
Formato do resumo
O resumo é um JSON fixo, pensado para responder as perguntas da cobrança: com quem
falou, se era decisor, o que ficou combinado.
{
| "atendeu_por":       |                             | "nome ou vazio",                 |     |     |     |     |     |
| -------------------- | --------------------------- | -------------------------------- | --- | --- | --- | --- | --- |
| "cargo":             | "cargo informado ou vazio", |                                  |     |     |     |     |     |
| "decisor":           | true,                       |                                  |     |     |     |     |     |
| "decisor_nome":      |                             | "quem decide, se foi citado",    |     |     |     |     |     |
| "empresa_usa_laser": |                             | "sim | nao | nao_informado",     |     |     |     |     |     |
| "interesse":         |                             | "nenhum | baixo | medio | alto", |     |     |     |     |     |
"equipamento_interesse": ["laser chapa", "laser tubo", "dobradeira", "solda"],
| "prazo_compra":    |                  | "texto curto ou vazio",                        |     |     |     |     |     |
| ------------------ | ---------------- | ---------------------------------------------- | --- | --- | --- | --- | --- |
| "objecoes":        | ["texto curto"], |                                                |     |     |     |     |     |
| "proximo_passo":   |                  | "texto curto",                                 |     |     |     |     |     |
| "data_retorno":    |                  | "AAAA-MM-DD ou vazio",                         |     |     |     |     |     |
| "canal_combinado": |                  | "ligacao | whatsapp | email | visita | vazio", |     |     |     |     |     |
"desfecho_sugerido": "falou_decisor | falou_terceiro | sem_interesse | interesse | retornar |
numero_invalido | empresa_encerrada | caixa_postal",
| "resumo_texto": |     | "3 a 5 linhas em português" |     |     |     |     |     |
| --------------- | --- | --------------------------- | --- | --- | --- | --- | --- |
}
Regras do modelo que gera o resumo: só afirmar o que está na transcrição; campo não
dito fica vazio;   só é verdadeiro se a pessoa disse que decide ou tem cargo de
decisor
dono, sócio, diretor, gerente geral ou presidente.

Efeitos no CRM
resumo_texto vira nota na empresa e na ligação.
data_retorno preenchida cria tarefa de retorno para a SDR (hoje só 13 de 77
interessados têm tarefa).
decisor = true com atendeu_por preenchido marca o contato como decisor em
contacts (hoje 5 de 256 contatos atendidos têm a marcação).
desfecho_sugerido preenche calls.desfecho quando vazio; a SDR pode corrigir.
No painel
A transcrição e o resumo passam a alimentar o bloco de decisor e o desfecho estruturado,
substituindo a classificação por palavra-chave nas notas.
LGPD, retenção e acesso
A gravação só entra em operação com o aviso ao interlocutor e uma regra de retenção
definida; os pontos abaixo são para validar com o contador ou jurídico, não conclusões
jurídicas.
Aviso no início da ligação, no script da SDR: "esta ligação pode ser gravada para fins de
qualidade e registro comercial". Confirmar se a Gama quer esse aviso falado em toda
chamada ou se basta na política de privacidade.
Finalidade registrada: registro da negociação comercial e treinamento da equipe.
Retenção proposta: áudio apagado do bucket logo após a transcrição confirmada (no
máximo 7 dias, para permitir reprocessar uma falha); transcrição e resumo ficam no
CRM como histórico da conversa enquanto a empresa for prospect ou cliente.
Acesso: ninguém ouve o áudio pelo CRM. A transcrição completa fica visível para
manager e acima; a SDR e os vendedores veem o resumo no histórico da empresa.
Serviços de transcrição fora do Brasil: registrar no mapeamento de dados que o áudio
é processado por terceiro no exterior e escolher fornecedor que não retenha o áudio
após processar (a OpenAI e a Deepgram têm opção de não retenção via API;
confirmar nos termos vigentes).
Pedido de exclusão do titular: apagar áudio e transcrição da ligação, mantendo só o

registro de que a ligação ocorreu.
Custos
O custo recorrente é pequeno diante do que se ganha em controle; o maior gasto é o
tempo de implementação.
Item Base Custo mensal estimado
Transcrição cerca de 14 h faladas/mês (dado de set a US$ 4 a 6
out/2026); OpenAI e Deepgram cobram por
minuto, na faixa de US$ 0,004 a 0,006
Resumo por modelo de linguagem cerca de 300 ligações atendidas/mês, texto curto abaixo de US$ 1
Armazenamento Supabase cerca de 14 h de MP3 por mês (menos de 1 GB), dentro do plano atual ou centavos
retenção de 90 dias
Gravação BR DID (reserva, 30 dias) pacote do painel R$ 9,90
Os preços por minuto variam por fornecedor e mudam; conferir a tabela vigente antes de
fechar. Com uma segunda SDR, tudo dobra e continua pequeno.
Ordem de implementação e checklist de aceite
Primeiro parar a perda de dados (agente), depois gravar, depois transcrever; cada etapa é
útil sozinha.
Etapa 0: agente confiável (antes de qualquer gravação)
Ler o log do agente de 21/10 e identificar por que parou
Heartbeat em telefonia_dispositivos.ultimo_uso_em a cada 5 min
Alerta no CRM e no painel para dispositivo sem heartbeat há 15 min em horário
comercial
Agente iniciando com o Windows e reiniciando sozinho
CombinarcomaSDR a isarnomesmodiaseoCRMnãoesti erregistrando

Combinar com a SDR: avisar no mesmo dia se o CRM não estiver registrando
Etapa 1: gravação
Validar aviso de gravação e retenção com contador ou jurídico
| Ativar gravação automática no MicroSIP, pasta  |     |     | C:\Gama\gravacoes | , MP3 |
| ---------------------------------------------- | --- | --- | ----------------- | ----- |
Conferir o padrão do nome do arquivo e o volume dos dois lados
Contratar gravação de 30 dias na BR DID (reserva)
| Migration Prisma:  | call_recordings                  |  e  calls.desfecho |     |     |
| ------------------ | -------------------------------- | ------------------ | --- | --- |
| Bucket  gravacoes  |  privado com políticas de acesso |                    |     |     |
Agente enviando arquivos e casando com  ; teste com 10 ligações reais, 100%
calls
| casadas ou marcadas  | sem_ligacao |     |     |     |
| -------------------- | ----------- | --- | --- | --- |
Etapa 2: transcrição e resumo
| Edge Function  | transcrever |  com webhook, retries e secrets |     |     |
| -------------- | ----------- | ------------------------------- | --- | --- |
Testar com 20 gravações: transcrição legível, resumo no formato fixo, nota criada no
histórico
Regras de efeito no CRM: tarefa de retorno, marcação de decisor, desfecho sugerido
Tela da ligação no CRM mostrando o resumo e, para manager e acima, a transcrição
completa; sem player de áudio
Etapa 3: painel e rotina
Painel passa a usar  calls.desfecho  e o resumo em vez de palavras-chave nas notas
Rotina mensal de reconciliação com o CSV da BR DID
Rotina de expurgo do áudio após a transcrição (máximo 7 dias)
Critério de aceite geral: em uma semana de operação, toda ligação completada na BR DID
tem par no CRM, gravação no bucket e resumo no histórico, sem intervenção manual.