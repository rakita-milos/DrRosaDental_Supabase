param(
  [int]$Days = 30,
  [string]$LogDir = $null
)

$ErrorActionPreference = "Stop"

if (-not $LogDir) {
  $LogDir = Join-Path (Split-Path -Parent $PSScriptRoot) "logs"
}

if ($Days -lt 1) {
  throw "Days must be at least 1."
}

if (-not (Test-Path -LiteralPath $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}

$cutoff = (Get-Date).AddDays(-$Days)
Get-ChildItem -LiteralPath $LogDir -File -Filter "*.log" |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  Remove-Item -Force
