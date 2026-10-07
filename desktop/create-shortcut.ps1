param([string]$DestinationDirectory)
$ErrorActionPreference = 'Stop'
if (-not $DestinationDirectory) { $DestinationDirectory = Split-Path -Parent $PSScriptRoot }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskShell = New-Object -ComObject WScript.Shell
$taskShortcut = $taskShell.CreateShortcut((Join-Path $DestinationDirectory '语随提词器.lnk'))
$taskShortcut.TargetPath = Join-Path $taskRoot 'client/语随.exe'
$taskShortcut.WorkingDirectory = $taskRoot
$taskShortcut.IconLocation = (Join-Path $taskRoot 'desktop/icon.ico') + ',0'
$taskShortcut.Description = '语随 · Whisper small 直播提词器'
$taskShortcut.Save()
