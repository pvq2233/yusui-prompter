$ErrorActionPreference = 'Stop'
$taskClient = Join-Path $PSScriptRoot 'client/语随.exe'
$taskPending = Join-Path $PSScriptRoot 'client/语随.pending.exe'
if (Test-Path -LiteralPath $taskPending) {
    try { Copy-Item -LiteralPath $taskPending -Destination $taskClient -Force; Remove-Item -LiteralPath $taskPending }
    catch { Write-Warning 'Close the running client and launch again to finish its icon update.' }
}
if (-not (Test-Path -LiteralPath $taskClient)) { throw 'Desktop client is missing. Extract the complete release, or run npm run build:desktop.' }
try { & (Join-Path $PSScriptRoot 'desktop/create-shortcut.ps1') } catch { Write-Warning 'Could not create a shortcut; starting the client directly.' }
Start-Process -FilePath $taskClient -WorkingDirectory $PSScriptRoot
