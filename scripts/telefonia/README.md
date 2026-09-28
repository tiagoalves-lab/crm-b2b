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

1. Copie esta pasta (`scripts/telefonia`) para a máquina, por exemplo em
   `C:\gama-telefonia`.
2. No CRM, em **Administração → Telefonia**, gere a credencial daquele
   computador e copie o endereço do CRM e o token.
3. **Feche o MicroSIP** (com ele aberto, a configuração que o instalador
   grava se perde ao fechar) e, na pasta, clique com o botão direito →
   **Abrir no Terminal**. Rode:

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
- `registrar-chamada.ps1` avisa o CRM quando a chamada começa, é atendida
  e termina. Nada mais.
- Não gravam áudio, não leem a tela, não guardam o número em lugar nenhum
  além do log local.
- O token identifica a máquina e a pessoa; não é senha de login e não dá
  acesso ao resto do CRM. Revogar no CRM derruba só o registro automático
  daquele computador.

## Nota para quem for editar estes scripts

Eles têm acento e travessão, e o PowerShell do Windows 10 (5.1) lê arquivo
sem BOM como ANSI — o travessão vira uma aspa solta e o script para de
abrir com "cadeia de caracteres não tem o terminador". Salve sempre em
**UTF-8 com BOM**.
