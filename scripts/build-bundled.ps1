Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    node scripts/write-dependency-notices.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
& (Join-Path $PSScriptRoot 'check-bundled-runtime.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location $projectRoot
try {
    npm run tauri -- build --config src-tauri/tauri.bundled.conf.json
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
