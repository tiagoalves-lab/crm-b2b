# Envio das gravações das ligações ao CRM (docs/telefonia-crm.md, decisão 1.6).
#
# O MicroSIP grava cada chamada atendida na pasta configurada pelo
# instalador. Este script sobe para o CRM tudo o que estiver nessa pasta e
# apaga daqui o que o CRM confirmou — inclusive o que ficou de uma vez
# anterior em que a internet ou o CRM falharam: a fila é a própria pasta.
#
# Roda no clique do botão Ligar (discar.ps1) e uma vez no fim do
# instalar.ps1. Tarefa agendada e aviso de fim de chamada do MicroSIP foram
# abandonados: o antivírus da máquina da SDR bloqueia os dois (2026-10-27).

param(
  # Quanto esperar pelo arquivo que o MicroSIP ainda está fechando. No fim
  # da ligação vale esperar; na rodada agendada, arquivo preso é ligação
  # em andamento e fica para a próxima.
  [int]$EsperaSegundos = 2
)

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $raiz 'config.json'
$logPath = Join-Path $raiz 'registro.log'

function Escrever-Log([string]$texto) {
  $linha = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Add-Content -Path $logPath -Value $linha -Encoding utf8
}

if (-not (Test-Path $configPath)) { exit 0 }
try {
  $config = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
} catch {
  exit 0
}
if (-not $config.apiUrl -or -not $config.token) { exit 0 }

# Pasta do instalador + as que ele achou com gravação antiga (pasta oculta
# na Área de Trabalho da SDR, 2026-10-27) + a que estiver configurada no
# MicroSIP agora: se alguém mudar a pasta na tela dele, o envio acompanha.
$pastas = @($config.gravacoes) + @($config.gravacoesAntigas) +
  @(Join-Path ([Environment]::GetFolderPath('Desktop')) 'Recordings')
$inis = @((Join-Path $env:AppData 'MicroSIP\microsip.ini'))
if ($config.microsip) { $inis += Join-Path (Split-Path -Parent $config.microsip) 'microsip.ini' }
foreach ($ini in ($inis | Where-Object { Test-Path $_ })) {
  foreach ($linha in (Get-Content $ini -Encoding utf8)) {
    if ($linha -match '^\s*recordingPath\s*=\s*(.+?)\s*$') { $pastas += $Matches[1] }
  }
}
$pastas = @($pastas | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') } |
  Select-Object -Unique | Where-Object { Test-Path $_ })
if ($pastas.Count -eq 0) { exit 0 }

# O MicroSIP só solta o arquivo quando fecha a gravação, e o aviso de fim
# de chamada pode chegar um instante antes disso.
function Esperar-Liberado([string]$caminho) {
  for ($i = 0; $i -le $EsperaSegundos; $i++) {
    try {
      $s = [System.IO.File]::Open($caminho, 'Open', 'Read', 'None')
      $s.Close()
      return $true
    } catch {
      if ($i -lt $EsperaSegundos) { Start-Sleep -Seconds 1 }
    }
  }
  return $false
}

# -Force: dentro de pasta oculta o arquivo pode estar oculto também. Fora
# da pasta do instalador, só sobe (e só apaga) o que tem o nome que o
# MicroSIP dá às gravações — a pasta pode ter outro áudio da pessoa.
$nomeMicrosip = '^\d{8}-\d{6}-.+-(outgoing|incoming)-.*\.(mp3|wav)$'
$arquivos = $pastas | ForEach-Object { Get-ChildItem -Path $_ -File -Force } |
  Where-Object {
    $_.Extension -in '.mp3', '.wav' -and
    ($_.DirectoryName.TrimEnd('\') -eq "$($config.gravacoes)".TrimEnd('\') -or $_.Name -match $nomeMicrosip)
  } |
  Sort-Object CreationTime

foreach ($arq in $arquivos) {
  if (-not (Esperar-Liberado $arq.FullName)) { continue }
  $arq.Refresh()
  if (-not $arq.Exists) { continue }  # a outra execução já enviou
  if ($arq.Length -eq 0) {
    # Chamada que caiu antes de haver áudio: não há o que guardar.
    Remove-Item -LiteralPath $arq.FullName -Force -ErrorAction SilentlyContinue
    Escrever-Log ("gravacao {0} -> vazia, descartada" -f $arq.Name)
    continue
  }

  $tipo = if ($arq.Extension -eq '.wav') { 'audio/wav' } else { 'audio/mpeg' }
  $uri = "{0}/telefonia/gravacoes?arquivo={1}&gravadoEm={2}" -f `
    $config.apiUrl.TrimEnd('/'),
    [uri]::EscapeDataString($arq.Name),
    [uri]::EscapeDataString($arq.CreationTimeUtc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"))

  try {
    $resposta = Invoke-RestMethod -Method Post -Uri $uri `
      -Headers @{ Authorization = ("Bearer {0}" -f $config.token) } `
      -ContentType $tipo `
      -InFile $arq.FullName `
      -TimeoutSec 180
    # Só apaga depois do "ok" do CRM: antes disso o arquivo é a única cópia.
    Remove-Item -LiteralPath $arq.FullName -Force -ErrorAction SilentlyContinue
    Escrever-Log ("gravacao {0} -> enviada ({1})" -f $arq.Name, $resposta.chamadaId)
  } catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -in 400, 413, 415) {
      # O CRM recusou o arquivo em si (não é áudio, grande demais):
      # reenviar não muda nada. Separa para alguém olhar, em vez de tentar
      # de novo para sempre.
      $recusadas = Join-Path $arq.DirectoryName 'recusadas'
      New-Item -ItemType Directory -Force -Path $recusadas | Out-Null
      Move-Item -LiteralPath $arq.FullName -Destination $recusadas -Force
      Escrever-Log ("gravacao {0} -> RECUSADA ({1}), movida para recusadas" -f $arq.Name, $status)
    } else {
      Escrever-Log ("gravacao {0} -> FALHOU, tenta de novo: {1}" -f $arq.Name, $_.Exception.Message)
    }
  }
}

exit 0
