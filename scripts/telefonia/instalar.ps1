# Instalador da telefonia na máquina do SDR (docs/telefonia-crm.md).
#
# Faz, nesta ordem:
#   1. acha o MicroSIP;
#   2. guarda o endereço do CRM e a credencial daquele computador;
#   3. prova que a máquina fala com o CRM (antes de qualquer outra coisa);
#   4. ensina o Windows a entregar o clique do botão "Ligar" ao MicroSIP;
#   5. liga o registro automático, escrevendo os quatro ganchos de chamada
#      na configuração do MicroSIP.
#
# Tudo só para o usuário atual — não exige administrador.
#
# Uso (PowerShell, na pasta onde este arquivo está):
#   .\instalar.ps1 -ApiUrl "https://ENDERECO-DO-CRM" -Token "gama-fone_..."
#
# Os dois valores saem do CRM, em Administração → Telefonia.

param(
  [Parameter(Mandatory = $true)][string]$ApiUrl,
  [Parameter(Mandatory = $true)][string]$Token,
  # Só se o MicroSIP tiver sido instalado num lugar fora do comum.
  [string]$MicroSipPath
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

function Passo([string]$texto) { Write-Host "  $texto" }

Write-Host ""
Write-Host "Telefonia do CRM Gama - instalacao" -ForegroundColor Cyan
Write-Host ""

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
$configPath = Join-Path $raiz 'config.json'
[pscustomobject]@{
  apiUrl   = $ApiUrl.TrimEnd('/')
  token    = $Token
  microsip = $microsip
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding utf8
Passo "Credencial guardada em config.json (fica so nesta maquina)"

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

$registrar = Join-Path $raiz 'registrar-chamada.ps1'
function LinhaDeEvento([string]$chave, [string]$evento) {
  "$chave=powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$registrar`" -Evento $evento -Telefone `"%1`""
}
$eventos = [ordered]@{
  'cmdOutgoingCall' = LinhaDeEvento 'cmdOutgoingCall' 'discando'
  'cmdIncomingCall' = LinhaDeEvento 'cmdIncomingCall' 'recebida'
  'cmdCallStart'    = LinhaDeEvento 'cmdCallStart'    'atendida'
  'cmdCallEnd'      = LinhaDeEvento 'cmdCallEnd'      'encerrada'
}

foreach ($iniPath in $inis) {
  # Cópia de segurança antes de mexer: o arquivo tem a configuração da
  # linha telefônica, e perder isso é o SDR sem telefone.
  Copy-Item $iniPath "$iniPath.bak-$(Get-Date -Format 'yyyyMMddHHmmss')" -Force

  $linhas = [System.Collections.Generic.List[string]](Get-Content $iniPath -Encoding utf8)

  # As chaves têm que cair DENTRO de [Settings]: jogadas no fim do arquivo,
  # caem em outra seção e o MicroSIP as ignora em silêncio.
  $inicioSettings = -1
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    if ($linhas[$i] -match '^\s*\[Settings\]\s*$') { $inicioSettings = $i; break }
  }
  if ($inicioSettings -lt 0) {
    $linhas.Add('[Settings]')
    $inicioSettings = $linhas.Count - 1
  }

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

  Set-Content -Path $iniPath -Value $linhas -Encoding utf8
  Passo "Registro automatico ligado em $iniPath"
}

Write-Host ""
Write-Host "Pronto." -ForegroundColor Green
Write-Host "Abra o MicroSIP e clique em Ligar no CRM."
Write-Host ""
