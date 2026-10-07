$ErrorActionPreference = 'Stop'
$taskState = Join-Path $PSScriptRoot 'data/server.json'
if (-not (Test-Path -LiteralPath $taskState)) { Write-Host 'No saved server process.'; return }
$taskServer = Get-Content -LiteralPath $taskState -Raw | ConvertFrom-Json
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskServer.pid)" -ErrorAction SilentlyContinue
$taskRunner = Join-Path $PSScriptRoot 'server_runner.py'
if ($taskProcess -and $taskProcess.CommandLine.Contains($taskRunner) -and $taskProcess.CommandLine.Contains($taskServer.python)) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $taskProcess.ProcessId /T /F
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the saved prompter process.' }
    Write-Host 'Prompter stopped.'
} else { Write-Host 'The saved server is no longer running.' }
