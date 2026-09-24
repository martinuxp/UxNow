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
    'RUNTIME_SOURCES.md'
)
foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $runtime $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Falta $relativePath en el runtime candidato. No se creara un instalador incompleto."
    }
}

Write-Host "Comprobacion minima superada: uxPlay $detectedVersion, plugins y archivo de fuentes/licencias presentes."
Write-Host 'Esta validacion no sustituye la prueba de audio en un Windows limpio.'
