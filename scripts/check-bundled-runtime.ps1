Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runtime = Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\bundled-candidate'
$uxplay = Join-Path $runtime 'bin\uxplay.exe'
$minimumVersion = [version]'1.73.7'
$upstreamSource = Join-Path (Split-Path $PSScriptRoot -Parent) 'vendor\uxplay\lib\raop_handlers.h'

if (-not (Test-Path -LiteralPath $uxplay -PathType Leaf)) {
    throw "No existe $uxplay. Compila uxPlay oficial y ejecuta scripts/stage-uxplay-runtime.ps1 antes de crear un instalador integrado."
}

$previousPath = $env:PATH
try {
    $env:PATH = (Join-Path $runtime 'bin') + [IO.Path]::PathSeparator + $previousPath
    $versionOutput = (& $uxplay -v 2>&1 | Out-String)
    $versionExitCode = $LASTEXITCODE
} finally {
    $env:PATH = $previousPath
}
if ($versionExitCode -ne 0 -or $versionOutput -notmatch 'UxPlay version\s+(\d+\.\d+(?:\.\d+)?)') {
    throw "No se pudo verificar la version de uxPlay en $uxplay."
}
$detectedVersion = [version]$Matches[1]
if ($detectedVersion -lt $minimumVersion) {
    throw "uxPlay $detectedVersion es anterior a $minimumVersion. No se empaquetara el runtime antiguo."
}
if (-not (Test-Path -LiteralPath $upstreamSource -PathType Leaf)) {
    throw "Falta el codigo fuente de uxPlay para comprobar las correcciones de seguridad."
}
$sourceText = Get-Content -LiteralPath $upstreamSource -Raw
if ($sourceText -notmatch 'memcpy\(proof,\s*client_proof,\s*sizeof\(proof\)\)' -or
    $sourceText -notmatch 'if\s*\(user_agent\)' -or
    $sourceText -notmatch 'if\s*\(audiomode\)') {
    throw "El checkout de uxPlay no contiene las tres correcciones del aviso GHSA-479c-ww7g-wgp8."
}

# WinSock 1 (wsock32) reads WinSock 2 option numbers differently: IP_MULTICAST_IF
# is ignored and mDNS replies leave through the lowest-metric adapter (VPN, VM).
$uxplayBytes = [IO.File]::ReadAllBytes($uxplay)
if ([Text.Encoding]::ASCII.GetString($uxplayBytes) -match '(?i)wsock32\.dll') {
    throw 'uxplay.exe importa wsock32.dll. Aplica patches/uxplay y recompila antes de empaquetar.'
}

$manifest = Join-Path $runtime 'RUNTIME_SOURCES.md'
$msysLicenses = Join-Path $runtime 'licenses\MSYS2'
$uxplayLicense = Join-Path $runtime 'licenses\uxPlay\LICENSE'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw 'Falta el inventario RUNTIME_SOURCES.md. Ejecuta scripts/write-runtime-manifest.ps1.'
}
if (-not (Test-Path -LiteralPath $msysLicenses -PathType Container) -or
    -not (Test-Path -LiteralPath $uxplayLicense -PathType Leaf)) {
    throw 'Faltan avisos de licencia de MSYS2 o uxPlay en el runtime.'
}
$manifestText = Get-Content -LiteralPath $manifest -Raw
$packageRows = [regex]::Matches($manifestText, '(?m)^\| `mingw-w64-[^`]+` \|')
if ($packageRows.Count -lt 1 -or
    $manifestText -notmatch 'repo\.msys2\.org/mingw/sources/' -or
    $manifestText -notmatch 'ffmpeg.*GPL-3\.0-or-later') {
    throw 'El inventario de runtime no contiene paquetes, fuentes versionadas y licencia FFmpeg.'
}
$licenseCount = (Get-ChildItem -LiteralPath $msysLicenses -Recurse -File | Measure-Object).Count
if ($licenseCount -lt 50) {
    throw "El runtime solo contiene $licenseCount textos de licencia MSYS2; se esperaba el conjunto completo."
}

$requiredFiles = @(
    'bin\libgstreamer-1.0-0.dll',
    'lib\gstreamer-1.0\libgstapp.dll',
    'lib\gstreamer-1.0\libgstcoreelements.dll',
    'lib\gstreamer-1.0\libgstlibav.dll',
    'lib\gstreamer-1.0\libgstaudioconvert.dll',
    'lib\gstreamer-1.0\libgstaudioresample.dll',
    'lib\gstreamer-1.0\libgstwasapi.dll',
    'lib\gstreamer-1.0\libgstvolume.dll',
    'lib\gstreamer-1.0\libgstlevel.dll',
    'lib\gstreamer-1.0\libgstplayback.dll',
    'lib\gstreamer-1.0\libgstautodetect.dll',
    'lib\gstreamer-1.0\libgstvideoparsersbad.dll',
    'RUNTIME_SOURCES.md',
    'licenses\uxPlay\LICENSE'
)
foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $runtime $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Falta $relativePath en el runtime candidato. No se creara un instalador incompleto."
    }
}

Write-Host "Comprobacion minima superada: uxPlay $detectedVersion, plugins y archivo de fuentes/licencias presentes."
Write-Host 'Esta validacion no sustituye la prueba de audio en un Windows limpio.'
