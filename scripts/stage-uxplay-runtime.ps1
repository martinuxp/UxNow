param([string]$MsysRoot = 'C:\msys64')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sourceExe = Join-Path $projectRoot 'vendor\uxplay\build\uxplay.exe'
$ucrt = Join-Path $MsysRoot 'ucrt64'
$sourceBin = Join-Path $ucrt 'bin'
$sourcePlugins = Join-Path $ucrt 'lib\gstreamer-1.0'
$sourceScanner = Join-Path $ucrt 'libexec\gstreamer-1.0\gst-plugin-scanner.exe'
$objdump = Join-Path $sourceBin 'objdump.exe'
$stage = Join-Path $projectRoot 'runtime\bundled-candidate'
$stageBin = Join-Path $stage 'bin'
$stagePlugins = Join-Path $stage 'lib\gstreamer-1.0'
$stageScanner = Join-Path $stage 'libexec\gstreamer-1.0'
foreach ($path in @($sourceExe, $sourceScanner, $objdump)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Falta $path." }
}
New-Item -ItemType Directory -Path $stageBin, $stagePlugins, $stageScanner -Force | Out-Null
$pending = [System.Collections.Generic.Queue[string]]::new()
$visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
function Add-Binary {
    param([string]$Source, [string]$Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    $pending.Enqueue($Source)
}
Add-Binary $sourceExe (Join-Path $stageBin 'uxplay.exe')
Add-Binary $sourceScanner (Join-Path $stageScanner 'gst-plugin-scanner.exe')
Add-Binary (Join-Path $sourceBin 'gst-inspect-1.0.exe') (Join-Path $stageBin 'gst-inspect-1.0.exe')
$pluginNames = @(
    'libgstapp.dll',
    'libgstcoreelements.dll',
    'libgstlibav.dll',
    'libgstaudioconvert.dll',
    'libgstaudioresample.dll',
    'libgstwasapi.dll',
    'libgstvolume.dll',
    'libgstlevel.dll',
    'libgstplayback.dll',
    'libgstautodetect.dll',
    'libgstvideoparsersbad.dll'
)
foreach ($name in $pluginNames) {
    $source = Join-Path $sourcePlugins $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Falta $source." }
    Add-Binary $source (Join-Path $stagePlugins $name)
}
while ($pending.Count -gt 0) {
    $binary = $pending.Dequeue()
    if (-not $visited.Add($binary)) { continue }
    $imports = & $objdump -p $binary | Select-String '^\s*DLL Name:\s*(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }
    if ($LASTEXITCODE -ne 0) { throw "No se pudieron leer las dependencias de $binary." }
    foreach ($name in $imports) {
        $source = Join-Path $sourceBin $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        $destination = Join-Path $stageBin $name
        if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) {
            Add-Binary $source $destination
        } else {
            $pending.Enqueue($source)
        }
    }
}
$files = Get-ChildItem -LiteralPath $stage -Recurse -File
$sizeMiB = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "Candidato creado en $stage ($($files.Count) archivos; $sizeMiB MiB)."
& (Join-Path $PSScriptRoot 'write-runtime-manifest.ps1') -MsysRoot $MsysRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'El _internal anterior no se ha modificado. El candidato aún requiere prueba en Windows limpio antes de distribuir.'
