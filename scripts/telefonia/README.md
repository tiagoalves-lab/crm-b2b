# Telefone do SDR no computador — instalação

São quatro passos, uma vez por máquina (Windows). O plano completo está em
`docs/telefonia-crm.md`.

## 1. Instalar o MicroSIP

Baixe a versão **Lite** em <https://www.microsip.org/downloads>,
descompacte e execute. Não precisa de administrador.

## 2. Configurar a linha da Gama

Abra o MicroSIP, clique na setinha ao lado do campo de digitar → **Add
account**, e preencha com o que aparece no painel da operadora, em
"Configurar linha" → aba SIP:

- **SIP server** e **SIP proxy**: o endereço `voz...` que o painel mostra
- **Username**: o número da linha
- **Domain**: o mesmo endereço do servidor
- **Password**: a senha da linha

Salve. No alto da janela tem que aparecer **Online**.

A senha da linha **não fica no CRM** e não deve ser enviada por chat,
e-mail ou documento. Se vazar, gere outra no painel da operadora.

Feche o MicroSIP.

## 3. Rodar o instalador

1. Descompacte o pacote (ou copie esta pasta) na máquina, por exemplo em
   `C:\gama-telefonia`.
2. **Feche o MicroSIP** (com ele aberto, a configuração que o instalador
   grava se perde ao fechar).
3. Dê dois cliques em **`INSTALAR.bat`**. Se a máquina já teve a
   telefonia, ele acha a instalação anterior e reaproveita a credencial;
   se não, pede o token gerado no CRM, em **Administração → Telefonia**.
   Antes de instalar, mostra o diagnóstico do registro anterior (quantos
   avisos chegaram ao CRM e o último erro, sem número de cliente).

Quem preferir o terminal pode rodar direto:

```powershell
.\instalar.ps1 -ApiUrl "https://ENDERECO-DO-CRM" -Token "gama-fone_..."
```

O instalador guarda a credencial, associa o botão **Ligar** do CRM ao
MicroSIP, liga o registro automático das chamadas e, no fim, manda um
sinal de teste ao CRM. Ele só termina com "Pronto" em verde se o CRM tiver
respondido — qualquer outra coisa na tela é problema a resolver antes de
sair da máquina.

## 4. Conferir

Abra o MicroSIP, entre no CRM e ligue para um celular seu pelo botão
**Ligar**. Ao desligar, a ligação tem que aparecer na Timeline da empresa,
com duração. Em **Administração → Telefonia**, a máquina passa a mostrar
"último sinal".

Se não aparecer, abra `registro.log` na pasta do script: cada evento
escreve ali uma linha dizendo se conseguiu falar com o CRM.

## Por que um endereço próprio e não o `sip:` padrão

Em computador com Office instalado, o `sip:` pertence ao **Skype for
Business**: clicar em Ligar abria a tela de login dele em vez de discar.
Disputar essa associação com o Office é briga perdida — ele a retoma a
cada atualização. Por isso o CRM usa um endereço próprio (`gamafone:`),
que o instalador registra só para o usuário daquela máquina.

## O que estes scripts fazem (e o que não fazem)

- `discar.ps1` recebe o clique do botão Ligar e abre o MicroSIP no número.
- `registrar-chamada.ps1` avisaria o CRM quando a chamada começa, é
  atendida e termina. **Desligado** (decisão do usuário, 2026-10-27): a
  gravação é um controle à parte e não muda nada no CRM. O instalador
  deixa os ganchos do MicroSIP vazios.
- A gravação é do próprio MicroSIP (o instalador liga a gravação automática
  em MP3 na pasta `gravacoes`, ao lado destes scripts).
- `enviar-gravacoes.ps1` sobe para o CRM o que estiver nessa pasta e apaga
  o que o CRM confirmou. Roda a cada clique em **Ligar** (dentro do
  `discar.ps1`) e uma vez no fim da instalação. Não existe tarefa agendada:
  o antivírus da máquina da SDR (Panda Dome) bloqueia PowerShell aberto
  pelo Agendador. Arquivo que o CRM recusar vai para `recusadas`, dentro da
  pasta onde estava.
- O envio também olha a pasta que estiver configurada no MicroSIP e a
  pasta padrão dele (`Área de Trabalho\Recordings`, oculta), onde as
  ligações da SDR ficaram antes da correção. Fora da pasta do instalador,
  só sobe (e apaga) arquivo com o nome que o MicroSIP dá às gravações.
- Não leem a tela e não guardam o número em lugar nenhum além do log local.

## Reinstalar numa máquina que já tem a telefonia

Feche o MicroSIP e dê dois cliques em `INSTALAR.bat` do pacote novo, em
qualquer pasta — o endereço do CRM e a credencial são reaproveitados da
instalação anterior.
- O token identifica a máquina e a pessoa; não é senha de login e não dá
  acesso ao resto do CRM. Revogar no CRM derruba só o registro automático
  daquele computador.

## Nota para quem for editar estes scripts

Eles têm acento e travessão, e o PowerShell do Windows 10 (5.1) lê arquivo
sem BOM como ANSI — o travessão vira uma aspa solta e o script para de
abrir com "cadeia de caracteres não tem o terminador". Salve sempre em
**UTF-8 com BOM**.
