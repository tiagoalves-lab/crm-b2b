# Registro automático de ligações do CRM (docs/telefonia-crm.md, Etapa 1).
#
# Roda na máquina do SDR, chamado pelo próprio MicroSIP nos eventos de
# chamada (ver README.md deste diretório). Não fica residente: cada evento
# é uma execução de poucos milissegundos que avisa o CRM.
#
# Uso (é o MicroSIP quem chama, não a pessoa):
#   powershell -ExecutionPolicy Bypass -File registrar-chamada.ps1 -Evento atendida -Telefone %1
#
# Configuração fica em config.json, ao lado deste arquivo:
#   { "apiUrl": "https://...", "token": "gama-fone_..." }
# O token é gerado no CRM, em Administração → Telefonia. Ele identifica a
# MÁQUINA e a pessoa — não é senha de login e não dá acesso ao resto do
# sistema.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('discando', 'atendida', 'encerrada', 'recebida')]
  [string]$Evento,

  [Parameter(Mandatory = $true)]
  [string]$Telefone
)

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $raiz 'config.json'
$logPath = Join-Path $raiz 'registro.log'

function Escrever-Log([string]$texto) {
  # Log curto e local: é o que permite descobrir instalação quebrada sem
  # depender de ninguém investigar o servidor. Só data, evento e desfecho —
  # nunca o token.
  $linha = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
  Add-Content -Path $logPath -Value $linha -Encoding utf8
}

if (-not (Test-Path $configPath)) {
  Escrever-Log "sem config.json — nada enviado"
  exit 0
}

try {
  $config = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
} catch {
  Escrever-Log "config.json ilegível — nada enviado"
  exit 0
}

if (-not $config.apiUrl -or -not $config.token) {
  Escrever-Log "config.json incompleto (apiUrl/token) — nada enviado"
  exit 0
}

$corpo = @{
  evento   = $Evento
  telefone = $Telefone
  em       = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Compress

try {
  $resposta = Invoke-RestMethod -Method Post `
    -Uri ("{0}/telefonia/eventos" -f $config.apiUrl.TrimEnd('/')) `
    -Headers @{ Authorization = ("Bearer {0}" -f $config.token) } `
    -ContentType 'application/json; charset=utf-8' `
    -Body $corpo `
    -TimeoutSec 15
  Escrever-Log ("{0} {1} -> ok ({2})" -f $Evento, $Telefone, $resposta.chamadaId)
} catch {
  # Falhar aqui nunca pode atrapalhar a ligação em si: o SDR está falando
  # com o cliente. Registra no log e sai em silêncio.
  Escrever-Log ("{0} {1} -> FALHOU: {2}" -f $Evento, $Telefone, $_.Exception.Message)
}

exit 0
