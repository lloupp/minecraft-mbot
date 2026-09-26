# Instala/atualiza o servidor Forge 1.20.1 do pz-server nesta pasta (Windows).
#
#   powershell -ExecutionPolicy Bypass -File install-server.ps1 -AcceptEula   # 1ª vez
#   powershell -ExecutionPolicy Bypass -File install-server.ps1               # atualizar
#
# Requisitos: Java 17 no PATH (ou -Java C:\caminho\bin\java.exe) e internet.
# Nunca apaga o mundo; mods fora do lock são movidos para mods-removidos\.
param([switch]$AcceptEula, [string]$Java = 'java')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Fail($msg) { Write-Host "`nERRO: $msg" -ForegroundColor Red; Read-Host 'Pressione Enter para fechar'; exit 1 }

try { $ver = (& $Java -XshowSettings:properties -version 2>&1 | Select-String 'java.specification.version') -replace '.*=\s*', '' }
catch { Fail "Java não encontrado. Instale o Java 17 (https://adoptium.net/temurin/releases/?version=17) ou use -Java C:\caminho\bin\java.exe" }
if ([int]$ver -lt 17) { Fail "Java $ver encontrado; o Forge 1.20.1 precisa do Java 17." }
if ([int]$ver -ne 17) { Write-Host "Aviso: Java $ver detectado. O recomendado e testado é o Java 17." -ForegroundColor Yellow }

if ($AcceptEula) { Set-Content eula.txt 'eula=true' -Encoding ascii }
elseif (-not (Select-String -Path eula.txt -Pattern '^eula=true' -Quiet -ErrorAction SilentlyContinue)) {
  Fail 'É preciso aceitar a EULA do Minecraft (https://aka.ms/MinecraftEULA). Rode com -AcceptEula.'
}

$lock = Get-Content mods.lock.json -Raw -Encoding UTF8 | ConvertFrom-Json
$forge = "$($lock.minecraft)-$($lock.forge)"
if (-not (Test-Path "libraries\net\minecraftforge\forge\$forge\win_args.txt")) {
  Write-Host "== Instalando Forge $forge"
  Invoke-WebRequest $lock.forge_installer.url -OutFile forge-installer.jar -UseBasicParsing
  if ((Get-FileHash forge-installer.jar -Algorithm SHA1).Hash.ToLower() -ne $lock.forge_installer.sha1) { Fail 'SHA-1 do instalador do Forge não confere' }
  & $Java -jar forge-installer.jar --installServer . *> forge-install.log
  if ($LASTEXITCODE -ne 0) { Fail 'instalação do Forge falhou (veja forge-install.log)' }
  Remove-Item forge-installer.jar, run.sh, run.bat -ErrorAction SilentlyContinue
} else { Write-Host "== Forge $forge já instalado" }

Write-Host '== Mods do servidor'
$mods = $lock.mods | Where-Object { $_.side -in 'server', 'both' }
New-Item -ItemType Directory -Force mods | Out-Null
$names = $mods | ForEach-Object { $_.file }
Get-ChildItem mods\*.jar | Where-Object { $names -notcontains $_.Name } | ForEach-Object {
  New-Item -ItemType Directory -Force mods-removidos | Out-Null
  Move-Item $_.FullName mods-removidos\ -Force; Write-Host "  movido para mods-removidos: $($_.Name)"
}
foreach ($m in $mods) {
  $target = Join-Path mods $m.file
  if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA512).Hash.ToLower() -eq $m.sha512) { Write-Host "  ok       $($m.file)"; continue }
  Invoke-WebRequest $m.url -OutFile "$target.part" -UseBasicParsing
  if ((Get-FileHash -LiteralPath "$target.part" -Algorithm SHA512).Hash.ToLower() -ne $m.sha512) { Remove-Item -LiteralPath "$target.part"; Fail "SHA-512 de $($m.name) não confere" }
  Move-Item -LiteralPath "$target.part" $target -Force; Write-Host "  baixado  $($m.file)"
}
Write-Host "`n$($mods.Count) mods instalados. Inicie com start-server.bat (RAM: set MC_RAM=6G)."
