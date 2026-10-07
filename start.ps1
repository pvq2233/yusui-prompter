param([ValidateSet('auto','cuda','cpu')][string]$Device='auto', [int]$Port=8765, [switch]$NoBrowser, [switch]$Restart)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskUrl = "http://127.0.0.1:$Port"
try { $taskExisting = Invoke-RestMethod -Uri "$taskUrl/api/status" -TimeoutSec 2 } catch { $taskExisting = $null }
if ($null -ne $taskExisting) {
    if ($taskExisting.app -ne 'whisper-live-prompter') { throw 'This port is in use by another application. Choose another -Port.' }
    if (-not $Restart) {
        Write-Host "Already running: $taskUrl"
        if (-not $NoBrowser) { Start-Process $taskUrl }
        exit 0
    }
    $taskStatePath = Join-Path $PSScriptRoot 'data/server.json'
    if (-not (Test-Path -LiteralPath $taskStatePath)) { throw 'Cannot identify the existing server safely. Close it before restarting.' }
    $taskSaved = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
    if ($taskSaved.port -ne $Port) { throw 'The running server is not the saved instance for this port. Close it before restarting.' }
}
$taskRuntime = Join-Path $PSScriptRoot 'data/runtime/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskRuntime)) {
    Write-Host 'Preparing a local Python environment...'
    & python -m venv (Join-Path $PSScriptRoot 'data/runtime')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10+ is required. Install Python and enable Add to PATH.' }
}
$taskDependencyStamp = Join-Path $PSScriptRoot 'data/dependencies.sha256'
$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try { $taskRequirementsHash = [BitConverter]::ToString($taskHasher.ComputeHash([System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'requirements.txt')))).Replace('-', '') }
finally { $taskHasher.Dispose() }
if (-not (Test-Path -LiteralPath $taskDependencyStamp) -or (Get-Content -LiteralPath $taskDependencyStamp -Raw).Trim() -ne $taskRequirementsHash) {
    & $taskRuntime -m pip install -r requirements.txt --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed. Check the network and retry.' }
    Set-Content -LiteralPath $taskDependencyStamp -Value $taskRequirementsHash -Encoding ASCII
}
if (-not (Test-Path -LiteralPath 'dist/index.html')) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed.' }
}
if ($null -ne $taskExisting -and $Restart) {
    Write-Host 'Restarting this copy of the prompter to load the latest version...'
    & (Join-Path $PSScriptRoot 'stop.ps1')
    $taskStillRunning = $true
    for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
        try { $null = Invoke-RestMethod -Uri "$taskUrl/api/status" -TimeoutSec 1 }
        catch { $taskStillRunning = $false; break }
        Start-Sleep -Milliseconds 250
    }
    if ($taskStillRunning) { throw 'The old server is still running. The update was not started.' }
}
$taskArguments = @('"' + (Join-Path $PSScriptRoot 'server_runner.py') + '"', '--port', "$Port", '--device', $Device)
Start-Process -FilePath $taskRuntime -ArgumentList $taskArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data/server.out.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data/server.err.log') | Out-Null
$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    Start-Sleep -Milliseconds 500
    try { $taskStatus = Invoke-RestMethod -Uri "$taskUrl/api/status" -TimeoutSec 1; if ($taskStatus.app -eq 'whisper-live-prompter') { $taskReady = $true; break } } catch { }
}
if (-not $taskReady) { throw 'Server did not start. See data/server.err.log.' }
Write-Host "Ready: $taskUrl"
Write-Host 'Whisper small loads in the background. Stop the service with stop.cmd.'
if (-not $NoBrowser) { Start-Process $taskUrl }
