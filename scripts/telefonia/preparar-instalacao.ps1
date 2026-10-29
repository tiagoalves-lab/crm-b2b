# Instalação por dois cliques (chamado pelo INSTALAR.bat).
#
# Antes de rodar o instalar.ps1, resolve as duas coisas que travavam quem
# instala sem saber de terminal:
#   1. a credencial: se esta pasta não tem config.json, procura a
#      instalação anterior (pelo caminho que ficou gravado nos ganchos do
#      microsip.ini) e reaproveita a credencial de lá; se não achar, pede o
#      token gerado em Administração → Telefonia;
#   2. o diagnóstico: o registro.log da instalação anterior diz se o
#      MicroSIP chegou a chamar o script alguma vez. Mostra só a contagem e
#      o último erro — nunca o número do cliente, que vai em cada linha.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $raiz 'config.json'
$apiPadrao = 'https://backend-production-bc44.up.railway.app'

# ── Achar a instalação anterior ─────────────────────────────────────────
# Mesmos lugares onde o instalar.ps1 procura o MicroSIP e o ini dele.
$exes = @(
  "$env:ProgramFiles\MicroSIP\microsip.exe",
  "${env:ProgramFiles(x86)}\MicroSIP\microsip.exe",
  "$env:LocalAppData\MicroSIP\microsip.exe",
  "$env:UserProfile\MicroSIP\microsip.exe",
  "$env:UserProfile\Desktop\MicroSIP\microsip.exe",
  "$env:UserProfile\Downloads\MicroSIP\microsip.exe"
) | Where-Object { Test-Path $_ }
$inis = @((Join-Path $env:AppData 'MicroSIP\microsip.ini')) +
  @($exes | ForEach-Object { Join-Path (Split-Path -Parent $_) 'microsip.ini' }) |
  Select-Object -Unique | Where-Object { Test-Path $_ }

$anteriores = @()
foreach ($ini in $inis) {
  foreach ($linha in (Get-Content $ini -Encoding utf8)) {
    if ($linha -match '-File\s+"([^"]+)\\registrar-chamada\.ps1"') {
      $anteriores += $Matches[1]
    }
  }
}
$anteriores += @('C:\gama-telefonia', "$env:UserProfile\Desktop\telefonia", "$env:UserProfile\Downloads\telefonia")
$anteriores = @($anteriores | Select-Object -Unique |
  Where-Object { $_ -ne $raiz -and (Test-Path (Join-Path $_ 'config.json')) })

if (-not (Test-Path $configPath) -and $anteriores.Count -gt 0) {
  Copy-Item (Join-Path $anteriores[0] 'config.json') $configPath
  Write-Host "  Credencial reaproveitada da instalacao anterior ($($anteriores[0]))"
}

# ── Diagnóstico do registro anterior ────────────────────────────────────
$logs = @($anteriores + $raiz | ForEach-Object { Join-Path $_ 'registro.log' } |
  Where-Object { Test-Path $_ })
Write-Host ""
Write-Host "Diagnostico da instalacao anterior" -ForegroundColor Cyan
if ($logs.Count -eq 0) {
  Write-Host "  Nenhum registro.log encontrado: o MicroSIP nunca chamou o script de registro."
} else {
  $linhas = @($logs | ForEach-Object { Get-Content $_ -Encoding utf8 })
  $ok = @($linhas | Where-Object { $_ -match '-> ok' }).Count
  $falhas = @($linhas | Where-Object { $_ -match 'FALHOU' })
  $outras = $linhas.Count - $ok - $falhas.Count
  Write-Host "  Linhas no registro: $($linhas.Count)  |  enviadas: $ok  |  falharam: $($falhas.Count)  |  outras: $outras"
  if ($linhas.Count -gt 0) {
    Write-Host "  Primeira: $(($linhas[0] -split ' ')[0..1] -join ' ')   Ultima: $(($linhas[-1] -split ' ')[0..1] -join ' ')"
  }
  if ($falhas.Count -gt 0) {
    Write-Host "  Ultimo erro: $(($falhas[-1] -split 'FALHOU: ', 2)[1])"
  }
  $semNumero = @($linhas | Where-Object { $_ -match 'config\.json' } | Select-Object -Last 1)
  if ($semNumero) { Write-Host "  Aviso: $(($semNumero[0] -split ' ', 3)[2])" }
}
Write-Host ""

# ── Credencial que faltar ───────────────────────────────────────────────
if (Test-Path $configPath) {
  & (Join-Path $raiz 'instalar.ps1')
} else {
  Write-Host "Nao achei a credencial deste computador." -ForegroundColor Yellow
  Write-Host "  No CRM, abra Administracao > Telefonia, gere a credencial e cole aqui."
  $token = (Read-Host "  Credencial (comeca com gama-fone_)").Trim()
  if (-not $token) { Write-Host "  Nada colado, instalacao cancelada." -ForegroundColor Red; exit 1 }
  & (Join-Path $raiz 'instalar.ps1') -ApiUrl $apiPadrao -Token $token
}
