# Instalador da telefonia na máquina do SDR (docs/telefonia-crm.md).
#
# Faz, nesta ordem:
#   1. acha o MicroSIP;
#   2. guarda o endereço do CRM e a credencial daquele computador;
#   3. prova que a máquina fala com o CRM (antes de qualquer outra coisa);
#   4. ensina o Windows a entregar o clique do botão "Ligar" ao MicroSIP;
#   5. liga a gravação automática das ligações no MicroSIP (os ganchos de
#      registro de chamada ficam desligados — ver passo 5);
#   6. envia já as gravações pendentes (depois, cada clique em Ligar envia).
#
# Tudo só para o usuário atual — não exige administrador.
#
# Uso (PowerShell, na pasta onde este arquivo está):
#   .\instalar.ps1 -ApiUrl "https://ENDERECO-DO-CRM" -Token "gama-fone_..."
#
# Os dois valores saem do CRM, em Administração → Telefonia. Numa máquina
# que já foi instalada, basta `.\instalar.ps1`: endereço e credencial são
# reaproveitados do config.json que já está na pasta.

param(
  [string]$ApiUrl,
  [string]$Token,
  # Só se o MicroSIP tiver sido instalado num lugar fora do comum.
  [string]$MicroSipPath
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

function Passo([string]$texto) { Write-Host "  $texto" }

Write-Host ""
Write-Host "Telefonia do CRM Gama - instalacao" -ForegroundColor Cyan
Write-Host ""

# Pasta que chegou por download ou zip vem marcada como "da internet", e o
# Windows barra o oculto.vbs de abrir o PowerShell ("Permissão negada" na
# máquina da SDR, 2026-10-27). Tirar a marca é o que o "Desbloquear" das
# propriedades do arquivo faz.
Get-ChildItem -Path $raiz -File | Unblock-File

# Reinstalação: o que não veio na linha de comando sai do config.json que
# a instalação anterior deixou.
$configPath = Join-Path $raiz 'config.json'
if ((-not $ApiUrl -or -not $Token) -and (Test-Path $configPath)) {
  $anterior = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
  if (-not $ApiUrl) { $ApiUrl = $anterior.apiUrl }
  if (-not $Token) { $Token = $anterior.token }
}
if (-not $ApiUrl -or -not $Token) {
  Write-Host "Falta o endereco do CRM e a credencial deste computador." -ForegroundColor Red
  Write-Host "Use: .\instalar.ps1 -ApiUrl ""https://..."" -Token ""gama-fone_..."""
  Write-Host "Os dois saem do CRM, em Administracao > Telefonia."
  exit 1
}

# ── 1. Encontrar o MicroSIP ─────────────────────────────────────────────
$candidatos = @(
  $MicroSipPath,
  "$env:ProgramFiles\MicroSIP\microsip.exe",
  "${env:ProgramFiles(x86)}\MicroSIP\microsip.exe",
  "$env:LocalAppData\MicroSIP\microsip.exe",
  "$env:UserProfile\MicroSIP\microsip.exe",
  "$env:UserProfile\Desktop\MicroSIP\microsip.exe",
  "$env:UserProfile\Downloads\MicroSIP\microsip.exe"
) | Where-Object { $_ -and (Test-Path $_) }

$microsip = $candidatos | Select-Object -First 1
if (-not $microsip) {
  Write-Host "MicroSIP nao encontrado." -ForegroundColor Red
  Write-Host "Instale de https://www.microsip.org/downloads (versao Lite) e rode este script de novo."
  Write-Host "Se ele estiver noutra pasta, use: .\instalar.ps1 -ApiUrl ... -Token ... -MicroSipPath 'C:\caminho\microsip.exe'"
  exit 1
}
Passo "MicroSIP encontrado em $microsip"

# ── 2. Guardar endereço do CRM + credencial da máquina ──────────────────
# A pasta de gravações fica junto dos scripts: o MicroSIP grava ali e o
# registrar-chamada.ps1 envia e apaga ao fim de cada ligação.
$gravacoes = Join-Path $raiz 'gravacoes'
New-Item -ItemType Directory -Force -Path $gravacoes | Out-Null

# Gravações que ficaram fora dessa pasta. Na máquina da SDR o MicroSIP
# gravava numa pasta oculta da Área de Trabalho, que o envio não olhava
# (achado com o usuário, 2026-10-27). Entram na lista: a pasta que o
# MicroSIP tinha configurada (no ini atual e nas cópias de segurança que
# este instalador deixa) e qualquer pasta da Área de Trabalho, oculta ou
# não, que tenha áudio dentro. O envio passa a olhar todas.
$iniDirs = @((Join-Path $env:AppData 'MicroSIP'), (Split-Path -Parent $microsip))
$extras = @()
foreach ($dir in $iniDirs) {
  Get-ChildItem -Path $dir -Filter 'microsip.ini*' -File -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      foreach ($linha in (Get-Content $_.FullName -Encoding utf8)) {
        if ($linha -match '^\s*recordingPath\s*=\s*(.+?)\s*$') { $extras += $Matches[1] }
      }
    }
}
# Só conta arquivo com o nome que o MicroSIP dá (data-hora-número-direção):
# o envio apaga o que sobe, e música ou áudio pessoal não pode entrar.
$nomeMicrosip = '^\d{8}-\d{6}-.+-(outgoing|incoming)-.*\.(mp3|wav)$'
$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
# Pasta padrão do MicroSIP quando ninguém configura outra — era onde as
# ligações da SDR estavam (C:\Users\<usuário>\Desktop\Recordings, oculta).
$extras += Join-Path $areaDeTrabalho 'Recordings'
Get-ChildItem -Path $areaDeTrabalho -Directory -Recurse -Depth 2 -Force -ErrorAction SilentlyContinue |
  ForEach-Object {
    $audios = @(Get-ChildItem -Path $_.FullName -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in '.mp3', '.wav' })
    $ligacoes = @($audios | Where-Object { $_.Name -match $nomeMicrosip })
    if ($ligacoes.Count -gt 0) { $extras += $_.FullName }
    elseif ($audios.Count -gt 0 -and $_.FullName -ne $gravacoes) {
      Passo "Pasta com audio fora do padrao do MicroSIP (nao enviada): $($_.FullName) ($($audios.Count) arquivos)"
    }
  }
$extras = @($extras | ForEach-Object { $_.TrimEnd('\') } | Select-Object -Unique |
  Where-Object { $_ -ne $gravacoes -and $_ -notlike '*\recusadas' -and (Test-Path $_) })

[pscustomobject]@{
  apiUrl    = $ApiUrl.TrimEnd('/')
  token     = $Token
  microsip  = $microsip
  gravacoes = $gravacoes
  gravacoesAntigas = $extras
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding utf8
Passo "Credencial guardada em config.json (fica so nesta maquina)"
foreach ($p in $extras) {
  $n = @(Get-ChildItem -Path $p -File -Force | Where-Object { $_.Name -match $nomeMicrosip }).Count
  Passo "Gravacoes antigas a enviar: $p ($n arquivos)"
}

# ── 3. Provar, já, que esta máquina fala com o CRM ──────────────────────
# Sinal sem número: o CRM marca "último sinal" desta máquina e não cria
# chamada nenhuma. Vem ANTES da configuração do MicroSIP de propósito — se
# a credencial ou o endereço estiverem errados, não adianta seguir, e quem
# instala precisa saber na hora (achado com o usuário, 2026-09-25: a
# instalação "terminou" numa máquina que nunca falou com o CRM, e só
# descobrimos olhando o servidor).
try {
  $corpo = @{ evento = 'encerrada'; telefone = '0' } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post `
    -Uri ("{0}/telefonia/eventos" -f $ApiUrl.TrimEnd('/')) `
    -Headers @{ Authorization = ("Bearer {0}" -f $Token) } `
    -ContentType 'application/json; charset=utf-8' `
    -Body $corpo -TimeoutSec 20 | Out-Null
  Passo "CRM respondeu: credencial aceita"
} catch {
  Write-Host ""
  Write-Host "Esta maquina NAO conseguiu falar com o CRM:" -ForegroundColor Red
  Write-Host "  $($_.Exception.Message)"
  Write-Host "  Confira o endereco e a credencial em Administracao > Telefonia."
  exit 1
}

# ── 4. Ensinar o Windows a entregar o clique ao MicroSIP ────────────────
# Endereço próprio (gamafone:) em vez do sip: padrão: em máquina com
# Office, o sip: pertence ao Skype for Business, e o clique abria a tela
# de login dele. Registro só em HKCU — não precisa de administrador.
$discar = Join-Path $raiz 'discar.ps1'
$comando = "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$discar`" -Uri `"%1`""

New-Item -Path 'HKCU:\Software\Classes\gamafone' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\gamafone' -Name '(default)' -Value 'URL:CRM Gama telefonia'
Set-ItemProperty -Path 'HKCU:\Software\Classes\gamafone' -Name 'URL Protocol' -Value ''
New-Item -Path 'HKCU:\Software\Classes\gamafone\shell\open\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\gamafone\shell\open\command' -Name '(default)' -Value $comando
Passo "Botao Ligar do CRM associado ao MicroSIP"

# ── 5. Ligar o registro automático das chamadas ─────────────────────────
# O MicroSIP guarda a configuração em dois lugares possíveis: a versão
# instalada usa %AppData%\MicroSIP\microsip.ini, e a versão Lite (portátil)
# usa um microsip.ini ao lado do próprio programa. A primeira versão deste
# instalador só olhava o primeiro caminho — na máquina da SDR o arquivo
# estava do lado do programa, o script saía antes de ligar o registro e
# nenhuma ligação chegava ao CRM (achado com o usuário, 2026-09-25).
$possiveis = @(
  (Join-Path $env:AppData 'MicroSIP\microsip.ini'),
  (Join-Path (Split-Path -Parent $microsip) 'microsip.ini')
) | Select-Object -Unique

$inis = @($possiveis | Where-Object { Test-Path $_ })

if ($inis.Count -eq 0) {
  Write-Host ""
  Write-Host "Falta um passo:" -ForegroundColor Yellow
  Write-Host "  Abra o MicroSIP uma vez, configure a linha da Gama e feche."
  Write-Host "  Depois rode este script de novo para ligar o registro automatico."
  exit 0
}

# Com o MicroSIP aberto, ele reescreve o próprio ini ao fechar e desfaz o
# que gravarmos agora.
if (Get-Process -Name 'microsip' -ErrorAction SilentlyContinue) {
  Write-Host ""
  Write-Host "Feche o MicroSIP e rode este script de novo." -ForegroundColor Yellow
  Write-Host "  Com ele aberto, a configuracao que eu gravo agora se perde ao fechar."
  exit 1
}

# Ganchos de chamada DESLIGADOS (decisão do usuário, 2026-10-27): a
# gravação é um controle à parte e não pode mudar nada no CRM — com os
# ganchos ativos, a ligação passaria a se encerrar sozinha na tela e a
# chamada recebida a virar registro. Chave vazia apaga o gancho que uma
# instalação anterior tenha deixado. O envio do áudio fica só com a tarefa
# agendada. Para religar, a linha de cada chave volta a ser:
#   powershell ... -File "<pasta>\registrar-chamada.ps1" -Evento <discando|recebida|atendida|encerrada> -Telefone "%1"
$eventos = [ordered]@{
  'cmdOutgoingCall' = 'cmdOutgoingCall='
  'cmdIncomingCall' = 'cmdIncomingCall='
  'cmdCallStart'    = 'cmdCallStart='
  'cmdCallEnd'      = 'cmdCallEnd='
  # Gravação automática de toda chamada atendida, em MP3, na pasta que o
  # script envia ao CRM. Chaves conferidas no código do MicroSIP
  # (settings.cpp / msip_call_recording_start), seção [Settings].
  'autoRecording'   = 'autoRecording=1'
  'recordingFormat' = 'recordingFormat=mp3'
  'recordingPath'   = "recordingPath=$gravacoes"
}

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
using System.Text;
public static class GamaIni {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetPrivateProfileString(string secao, string chave, string padrao, StringBuilder valor, int tamanho, string arquivo);
}
'@

foreach ($iniPath in $inis) {
  # Cópia de segurança antes de mexer: o arquivo tem a configuração da
  # linha telefônica, e perder isso é o SDR sem telefone.
  Copy-Item $iniPath "$iniPath.bak-$(Get-Date -Format 'yyyyMMddHHmmss')" -Force

  $linhas = [System.Collections.Generic.List[string]](Get-Content $iniPath -Encoding utf8)

  # As chaves têm que cair DENTRO de [Settings]: jogadas no fim do arquivo,
  # caem em outra seção e o MicroSIP as ignora em silêncio. Vale para TODA
  # seção [Settings] do arquivo: a gravação antiga em UTF-8 escondia a
  # primeira, e o MicroSIP, ao fechar, criava outra no fim do arquivo.
  $secoes = @()
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    if ($linhas[$i] -match '^\s*\[Settings\]\s*$') { $secoes += $i }
  }
  if ($secoes.Count -eq 0) {
    $linhas.Add('[Settings]')
    $secoes = @($linhas.Count - 1)
  }

  # De trás pra frente: inserir linha numa seção não desloca as anteriores.
  [array]::Reverse($secoes)
  foreach ($inicioSettings in $secoes) {
    $fimSettings = $linhas.Count
    for ($i = $inicioSettings + 1; $i -lt $linhas.Count; $i++) {
      if ($linhas[$i] -match '^\s*\[.+\]\s*$') { $fimSettings = $i; break }
    }

    foreach ($chave in $eventos.Keys) {
      $indice = -1
      for ($i = $inicioSettings + 1; $i -lt $fimSettings; $i++) {
        if ($linhas[$i] -match "^\s*$chave\s*=") { $indice = $i; break }
      }
      if ($indice -ge 0) {
        $linhas[$indice] = $eventos[$chave]
      } else {
        $linhas.Insert($fimSettings, $eventos[$chave])
        $fimSettings++
      }
    }
  }

  # UTF-16 (Unicode), o formato em que o próprio MicroSIP cria o arquivo.
  # Gravado em UTF-8 com BOM, o Windows lê o BOM como parte do nome da
  # primeira seção: [Settings] some, a linha telefônica (em [Account1])
  # segue funcionando e os ganchos e a gravação são ignorados em silêncio.
  # Era por isso que nenhuma ligação chegava sozinha ao CRM (achado em
  # 2026-10-27, conferido com GetPrivateProfileString).
  Set-Content -Path $iniPath -Value $linhas -Encoding Unicode

  # Prova: lê de volta pelo mesmo caminho que o MicroSIP usa.
  $lido = New-Object System.Text.StringBuilder 1024
  [void][GamaIni]::GetPrivateProfileString('Settings', 'recordingPath', '', $lido, 1024, $iniPath)
  $gancho = New-Object System.Text.StringBuilder 1024
  [void][GamaIni]::GetPrivateProfileString('Settings', 'cmdCallEnd', '', $gancho, 1024, $iniPath)
  if ($lido.ToString() -ne $gravacoes -or $gancho.ToString() -ne '') {
    Write-Host ""
    Write-Host "A configuracao do MicroSIP foi gravada mas o Windows nao a enxerga:" -ForegroundColor Red
    Write-Host "  $iniPath"
    Write-Host "  Mande uma foto desta tela para quem cuida do CRM."
    exit 1
  }
  Passo "Gravacao automatica ligada (registro de chamada desligado) em $iniPath (conferido)"
}

# ── 6. Envio das gravações ──────────────────────────────────────────────
# Sem tarefa agendada: na máquina da SDR o antivírus (Panda Dome) bloqueia
# o PowerShell aberto pelo Agendador/wscript como "programa legítimo usado
# para ações maliciosas" (2026-10-27). O envio roda no clique do botão
# Ligar (discar.ps1), que o antivírus aceita — cada ligação nova leva as
# gravações das anteriores. Aqui só se apaga a tarefa de uma instalação
# antiga e se envia, já, o que estiver pendente.
$nomeTarefa = 'CRM Gama - envio de gravacoes'
if (Get-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $nomeTarefa -Confirm:$false
  Passo "Envio agendado antigo removido (o antivirus bloqueava)"
}
Get-ChildItem -Path $raiz -Filter 'oculto.vbs' -File | Remove-Item -Force

$logPath = Join-Path $raiz 'registro.log'
$antes = if (Test-Path $logPath) { @(Get-Content $logPath -Encoding utf8).Count } else { 0 }
& (Join-Path $raiz 'enviar-gravacoes.ps1')
$novas = if (Test-Path $logPath) { @(Get-Content $logPath -Encoding utf8 | Select-Object -Skip $antes) } else { @() }
$enviadas = @($novas | Where-Object { $_ -match '-> enviada' }).Count
$problemas = @($novas | Where-Object { $_ -match 'FALHOU|RECUSADA' })
Passo "Gravacoes enviadas agora: $enviadas"
if ($problemas.Count -gt 0) {
  Write-Host "  Gravacoes com problema: $($problemas.Count) (ficam para a proxima ligacao)" -ForegroundColor Yellow
  Write-Host "  Ultimo: $(($problemas[-1] -split '-> ', 2)[1])"
}

Write-Host ""
Write-Host "Pronto." -ForegroundColor Green
Write-Host "Abra o MicroSIP e clique em Ligar no CRM."
Write-Host ""
