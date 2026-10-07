param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 22.12+ (including npm), reopen this window, and try again.'
}
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency download failed. Check the network and retry.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
& npm.cmd run build:desktop
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
if (-not $NoLaunch) { & (Join-Path $PSScriptRoot 'start-client.ps1') }
