# Baixa os mods do CLIENTE (Forge 1.20.1) para a pasta mods do seu Minecraft (Windows).
#
#   powershell -ExecutionPolicy Bypass -File install-client.ps1
#   powershell -ExecutionPolicy Bypass -File install-client.ps1 -ModsDir "C:\...\.minecraft\mods"
#
# Padrão: %APPDATA%\.minecraft\mods (TLauncher e launcher oficial usam essa pasta).
# Mods que não estão na lista são movidos para ..\mods-removidos (nada é apagado).
param([string]$ModsDir = (Join-Path $env:APPDATA '.minecraft\mods'))
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$lock = Get-Content mods.lock.json -Raw -Encoding UTF8 | ConvertFrom-Json
$mods = $lock.mods | Where-Object { $_.side -in 'client', 'both' }
New-Item -ItemType Directory -Force $ModsDir | Out-Null
$names = $mods | ForEach-Object { $_.file }
$removed = Join-Path (Split-Path $ModsDir -Parent) 'mods-removidos'
Get-ChildItem (Join-Path $ModsDir '*.jar') | Where-Object { $names -notcontains $_.Name } | ForEach-Object {
  New-Item -ItemType Directory -Force $removed | Out-Null
  Move-Item $_.FullName $removed -Force; Write-Host "  movido para mods-removidos: $($_.Name)"
}
foreach ($m in $mods) {
  $target = Join-Path $ModsDir $m.file
  if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA512).Hash.ToLower() -eq $m.sha512) { Write-Host "  ok       $($m.file)"; continue }
  Invoke-WebRequest $m.url -OutFile "$target.part" -UseBasicParsing
  if ((Get-FileHash -LiteralPath "$target.part" -Algorithm SHA512).Hash.ToLower() -ne $m.sha512) {
    Remove-Item -LiteralPath "$target.part"; Write-Host "ERRO: SHA-512 de $($m.name) não confere" -ForegroundColor Red; exit 1
  }
  Move-Item -LiteralPath "$target.part" $target -Force; Write-Host "  baixado  $($m.file)"
}
Write-Host "`n$($mods.Count) mods em $ModsDir. Abra o perfil Forge 1.20.1 ($($lock.forge)) com 4,5-5 GB de RAM."
Read-Host 'Pressione Enter para fechar'
