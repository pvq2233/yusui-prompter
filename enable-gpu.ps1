$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskPython = Join-Path $PSScriptRoot 'data/runtime/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Run start.cmd once before enabling GPU.' }
& $taskPython -m pip install -r requirements-gpu.txt --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw 'GPU runtime installation failed.' }
Write-Host 'GPU runtime installed locally. Restart with stop.cmd and start.cmd.'
