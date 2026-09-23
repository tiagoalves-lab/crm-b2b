# Instalador da telefonia na máquina do SDR (docs/telefonia-crm.md).
#
# Faz três coisas, todas só para o usuário atual (não exige administrador):
#   1. guarda o endereço do CRM e a credencial daquele computador;
#   2. ensina o Windows a entregar o clique do botão "Ligar" ao MicroSIP;
#   3. liga o registro automático, escrevendo os quatro ganchos de chamada
#      na configuração do MicroSIP.
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
  "$env:UserProfile\MicroSIP\microsip.exe"
) | Where-Object { $_ -and (Test-Path $_) }

$microsip = $candidatos | Select-Object -First 1
if (-not $microsip) {
  Write-Host "MicroSIP nao encontrado." -ForegroundColor Red
  Write-Host "Instale de https://www.microsip.org/downloads (versao Lite) e rode este script de novo."
  Write-Host "Se instalou noutra pasta, use: .\instalar.ps1 -ApiUrl ... -Token ... -MicroSipPath 'C:\caminho\microsip.exe'"
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

# ── 3. Ensinar o Windows a entregar o clique ao MicroSIP ────────────────
# Endereço próprio (gamafone:) em vez do sip: padrão: em maquina com
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

# ── 4. Ligar o registro automático das chamadas ─────────────────────────
$iniPath = Join-Path $env:AppData 'MicroSIP\microsip.ini'
if (-not (Test-Path $iniPath)) {
  Write-Host ""
  Write-Host "Falta um passo:" -ForegroundColor Yellow
  Write-Host "  Abra o MicroSIP uma vez, configure a linha da Gama e feche."
  Write-Host "  Depois rode este script de novo para ligar o registro automatico."
  exit 0
}

$registrar = Join-Path $raiz 'registrar-chamada.ps1'
function LinhaDeEvento([string]$chave, [string]$evento) {
  "$chave=powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$registrar`" -Evento $evento -Telefone `"%1`""
}
$eventos = @{
  'cmdOutgoingCall' = LinhaDeEvento 'cmdOutgoingCall' 'discando'
  'cmdIncomingCall' = LinhaDeEvento 'cmdIncomingCall' 'recebida'
  'cmdCallStart'    = LinhaDeEvento 'cmdCallStart'    'atendida'
  'cmdCallEnd'      = LinhaDeEvento 'cmdCallEnd'      'encerrada'
}

# Cópia de segurança antes de mexer: o arquivo tem a configuração da linha
# telefônica, e perder isso é o SDR sem telefone.
Copy-Item $iniPath "$iniPath.bak-$(Get-Date -Format 'yyyyMMddHHmmss')" -Force

$linhas = [System.Collections.Generic.List[string]](Get-Content $iniPath -Encoding utf8)
foreach ($chave in $eventos.Keys) {
  $indice = -1
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    if ($linhas[$i] -match "^\s*$chave\s*=") { $indice = $i; break }
  }
  if ($indice -ge 0) { $linhas[$indice] = $eventos[$chave] } else { $linhas.Add($eventos[$chave]) }
}
Set-Content -Path $iniPath -Value $linhas -Encoding utf8
Passo "Registro automatico ligado (copia de seguranca do microsip.ini guardada ao lado)"

Write-Host ""
Write-Host "Pronto." -ForegroundColor Green
Write-Host "Feche e abra o MicroSIP, depois clique em Ligar no CRM."
Write-Host ""
