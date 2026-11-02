param([string]$MsysRoot = 'C:\msys64')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $projectRoot 'runtime\bundled-candidate'
$packageDb = Join-Path $MsysRoot 'var\lib\pacman\local'
$licenseRoot = Join-Path $MsysRoot 'ucrt64\share\licenses'
$destination = Join-Path $runtime 'licenses\MSYS2'
$manifest = Join-Path $runtime 'RUNTIME_SOURCES.md'

foreach ($path in @($runtime, $packageDb, $licenseRoot)) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "No existe el directorio requerido: $path"
    }
}

$stageRoot = (Resolve-Path -LiteralPath $runtime).Path
$neededFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
Get-ChildItem -LiteralPath $stageRoot -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($stageRoot.Length).TrimStart('\').Replace('\', '/')
    [void]$neededFiles.Add("ucrt64/$relative")
}

function Get-PacmanField {
    param([string]$Text, [string]$Field)
    $pattern = "(?ms)^%$([regex]::Escape($Field))%\r?\n(.*?)(?=\r?\n%|\z)"
    return [regex]::Match($Text, $pattern).Groups[1].Value.Trim()
}

$packages = [System.Collections.Generic.List[object]]::new()
foreach ($packageDirectory in Get-ChildItem -LiteralPath $packageDb -Directory) {
    $fileList = Join-Path $packageDirectory.FullName 'files'
    $description = Join-Path $packageDirectory.FullName 'desc'
    if (-not (Test-Path -LiteralPath $fileList) -or -not (Test-Path -LiteralPath $description)) { continue }

    $ownsRuntimeFile = $false
    foreach ($file in [System.IO.File]::ReadLines($fileList)) {
        if ($neededFiles.Contains($file.TrimStart('/'))) {
            $ownsRuntimeFile = $true
            break
        }
    }
    if (-not $ownsRuntimeFile) { continue }

    $metadata = [System.IO.File]::ReadAllText($description)
    $name = Get-PacmanField $metadata 'NAME'
    $basePackage = Get-PacmanField $metadata 'BASE'
    $version = Get-PacmanField $metadata 'VERSION'
    $license = (Get-PacmanField $metadata 'LICENSE') -replace '\s+', ' '
    if ([string]::IsNullOrWhiteSpace($basePackage)) {
        throw "El paquete $name no tiene BASE en la base local de MSYS2; no se puede afirmar la correspondencia de sus fuentes."
    }
    $sourcePackage = $basePackage
    $sourceUrl = "https://repo.msys2.org/mingw/sources/$sourcePackage-$version.src.tar.zst"

    $packages.Add([pscustomobject]@{
        Name = $name
        BasePackage = $basePackage
        Version = $version
        License = $license
        SourceUrl = $sourceUrl
    })
}

if ($packages.Count -eq 0) { throw 'No se pudo relacionar ningún archivo del runtime con la base local de paquetes MSYS2.' }

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $licenseRoot | Copy-Item -Destination $destination -Recurse -Force
$uxplayLicense = Join-Path $projectRoot 'vendor\uxplay\LICENSE'
if (-not (Test-Path -LiteralPath $uxplayLicense -PathType Leaf)) {
    throw "Falta la licencia upstream de uxPlay: $uxplayLicense"
}
$uxplayLicenseDirectory = Join-Path $runtime 'licenses\uxPlay'
New-Item -ItemType Directory -Path $uxplayLicenseDirectory -Force | Out-Null
Copy-Item -LiteralPath $uxplayLicense -Destination $uxplayLicenseDirectory -Force
$uxplayPatches = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'patches\uxplay') -Filter '*.patch' -File | Sort-Object Name)
if ($uxplayPatches.Count -eq 0) { throw 'No se encontraron los parches de uxPlay en patches/uxplay.' }
$uxplayPatchDirectory = Join-Path $uxplayLicenseDirectory 'patches'
New-Item -ItemType Directory -Path $uxplayPatchDirectory -Force | Out-Null
foreach ($patch in $uxplayPatches) {
    & git -C (Join-Path $projectRoot 'vendor\uxplay') apply --reverse --check $patch.FullName
    if ($LASTEXITCODE -ne 0) { throw "El checkout de uxPlay no tiene aplicado $($patch.Name)." }
    Copy-Item -LiteralPath $patch.FullName -Destination $uxplayPatchDirectory -Force
}

$uxplayVersion = (& (Join-Path $runtime 'bin\uxplay.exe') -v 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $uxplayVersion -notmatch 'UxPlay version\s+1\.74') {
    throw "No se pudo verificar la versión esperada de uxPlay: $uxplayVersion"
}
$uxplayCommit = (& git -C (Join-Path $projectRoot 'vendor\uxplay') rev-parse HEAD).Trim()
$gstreamerVersion = (& (Join-Path $runtime 'bin\gst-inspect-1.0.exe') --version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $gstreamerVersion -notmatch 'GStreamer\s+1\.28\.7') {
    throw 'No se pudo verificar GStreamer 1.28.7 en el runtime candidato.'
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('# Runtime source and license inventory')
$lines.Add('')
$lines.Add('This file is generated from the local MSYS2 UCRT64 package database by `scripts/write-runtime-manifest.ps1`. It documents the runtime bundled under `_internal`; it does not replace the license texts shipped in `licenses/MSYS2`.')
$lines.Add('')
$lines.Add('## Receiver and media runtime')
$lines.Add('')
$lines.Add("- uxPlay: 1.74, upstream source commit ``$uxplayCommit`` from [FDH2/UxPlay](https://github.com/FDH2/UxPlay/tree/$uxplayCommit), with these build patches applied (copies in ``licenses/uxPlay/patches/``):")
foreach ($patch in $uxplayPatches) {
    $lines.Add("  - ``$($patch.Name)``")
}
$lines.Add('- GStreamer: 1.28.7, MSYS2 UCRT64 packages. The bundled WASAPI plugin is `gst-plugins-bad`; `wasapisink` was enumerated by `gst-inspect-1.0` during packaging validation.')
$lines.Add('- MSYS2 package license texts are copied from the matching UCRT64 installation into `licenses/MSYS2/`. Package-level source archives and declared licenses are listed below.')
$lines.Add('')
$lines.Add('## MSYS2 packages present in the runtime')
$lines.Add('')
$lines.Add('| Package | Version | Declared license | Corresponding MSYS2 source package |')
$lines.Add('| --- | --- | --- | --- |')
foreach ($package in ($packages | Sort-Object Name)) {
    $escapedLicense = $package.License.Replace('|', '\|')
    $lines.Add("| ``$($package.Name)`` | ``$($package.Version)`` | $escapedLicense | [source archive]($($package.SourceUrl)) |")
}
$lines.Add('')
$lines.Add('## Build provenance')
$lines.Add('')
$lines.Add('- Build environment: MSYS2 UCRT64 (x86_64), with installed package versions recorded above.')
$lines.Add('- uxPlay is built from the pinned official git submodule using the upstream Windows/MSYS2 instructions after applying `patches/uxplay/`; those patches only change the Windows build and no AirPlay protocol code is forked by UxNow.')
$lines.Add('- Runtime closure is staged by `scripts/stage-uxplay-runtime.ps1`, which copies the executable, required GStreamer plugins/scanner, and imported UCRT64 DLLs.')
$lines.Add('- The MSI/NSIS bundle embeds this directory as `_internal/` via `src-tauri/tauri.bundled.conf.json`.')
$lines.Add('')
$lines.Add('MSYS2 source archive index: https://repo.msys2.org/mingw/sources/ . Each link above is versioned to the installed package. If an archive is no longer available, use the package source links in the MSYS2 package metadata and the upstream project source. Keep this manifest and the accompanying license files with every binary redistribution.')
[System.IO.File]::WriteAllLines($manifest, $lines, [System.Text.UTF8Encoding]::new($false))

Write-Host "Runtime manifest written: $manifest"
Write-Host "MSYS2 packages inventoried: $($packages.Count)"
