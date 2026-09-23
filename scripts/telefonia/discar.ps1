# Discador — recebe o clique do botão "Ligar" do CRM e manda o número pro
# MicroSIP (docs/telefonia-crm.md, Etapa 1).
#
# O navegador abre um endereço do tipo `gamafone:5555999998888`, e o
# Windows entrega aqui (associação criada por instalar.ps1). Endereço
# próprio, e não o `sip:` padrão, porque em máquina com Office o `sip:`
# pertence ao Skype for Business — clicar em Ligar abria a tela de login
# do Skype em vez de discar.

param(
  [Parameter(Mandatory = $true)]
  [string]$Uri
)

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $raiz 'config.json'
$logPath = Join-Path $raiz 'registro.log'

function Escrever-Log([string]$texto) {
  $linha = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Add-Content -Path $logPath -Value $linha -Encoding utf8
}

# Só dígitos: o que vier depois de "gamafone:" já vem normalizado pelo CRM,
# mas nunca confiar em texto que chega de fora sem limpar.
$numero = ($Uri -replace '[^0-9]', '')
if (-not $numero) {
  Escrever-Log "discar: endereço sem número ($Uri)"
  exit 0
}

$microsip = $null
if (Test-Path $configPath) {
  try {
    $config = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($config.microsip) { $microsip = $config.microsip }
  } catch { }
}

if (-not $microsip -or -not (Test-Path $microsip)) {
  $candidatos = @(
    "$env:ProgramFiles\MicroSIP\microsip.exe",
    "${env:ProgramFiles(x86)}\MicroSIP\microsip.exe",
    "$env:LocalAppData\MicroSIP\microsip.exe",
    "$env:UserProfile\MicroSIP\microsip.exe"
  )
  $microsip = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $microsip) {
  Escrever-Log "discar: MicroSIP não encontrado — rode instalar.ps1 de novo"
  [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
  [System.Windows.Forms.MessageBox]::Show(
    'O MicroSIP não foi encontrado neste computador. Instale-o e rode instalar.ps1 de novo.',
    'CRM Gama - telefonia') | Out-Null
  exit 0
}

Start-Process -FilePath $microsip -ArgumentList $numero
Escrever-Log "discar: $numero"
exit 0
