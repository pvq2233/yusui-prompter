param([string]$ManifestPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $ManifestPath) { $ManifestPath = Join-Path $PSScriptRoot 'desktop/runtime-download.json' }
$taskData = Join-Path $PSScriptRoot 'data'
$taskRuntime = Join-Path $taskData 'runtime'
$taskPython = Join-Path $taskRuntime 'Scripts/python.exe'
if (Test-Path -LiteralPath $taskPython) { return }
$taskManifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($taskManifest.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid runtime checksum.' }
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
$taskArchive = Join-Path $taskData 'python-runtime-download.zip'
$taskTemporary = Join-Path $taskData ('runtime-setup-' + [Guid]::NewGuid().ToString('N'))
Write-Host 'Downloading the independent Python runtime...'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
    Invoke-WebRequest -UseBasicParsing -Uri $taskManifest.url -OutFile $taskArchive -TimeoutSec 300
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    $taskInput = [IO.File]::OpenRead($taskArchive)
    try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskInput)).Replace('-', '').ToLowerInvariant() }
    finally { $taskInput.Dispose(); $taskHasher.Dispose() }
    if ($taskHash -ne $taskManifest.sha256) {
        throw 'Runtime checksum mismatch. The download was not installed; try again.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($taskArchive, $taskTemporary)
    $taskTemporaryPython = Join-Path $taskTemporary 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $taskTemporaryPython)) { throw 'Runtime archive is incomplete.' }
    if (Test-Path -LiteralPath $taskRuntime) { throw 'An incomplete runtime already exists. Rename data/runtime and try again.' }
    Move-Item -LiteralPath $taskTemporary -Destination $taskRuntime
    & $taskPython -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize pip in the application runtime.' }
} finally {
    if (Test-Path -LiteralPath $taskArchive) { Remove-Item -LiteralPath $taskArchive -Force }
    # Delete only the uniquely named, verified temporary directory for this attempt.
    if (Test-Path -LiteralPath $taskTemporary) {
        $taskAbsolute = [IO.Path]::GetFullPath($taskTemporary)
        $taskAllowed = [IO.Path]::GetFullPath($taskData) + [IO.Path]::DirectorySeparatorChar
        if (-not $taskAbsolute.StartsWith($taskAllowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected temporary runtime path.' }
        Remove-Item -LiteralPath $taskAbsolute -Recurse -Force
    }
}
