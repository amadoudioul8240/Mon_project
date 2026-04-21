param(
    [string]$Destination = "..\..\agent-go-package.zip"
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path (Split-Path $root -Parent) -Parent
$agentGoRoot = Join-Path $repoRoot 'agent-go'
$powershellAgentGoRoot = Join-Path $repoRoot 'powershell\agent-go'
$destinationPath = [System.IO.Path]::GetFullPath((Join-Path $root $Destination))
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("it-monitoring-agent-go-package-" + [guid]::NewGuid().ToString('N'))

if (Test-Path $destinationPath) {
    Remove-Item $destinationPath -Force
}

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

try {
    Copy-Item -Path $agentGoRoot -Destination (Join-Path $stagingRoot 'agent-go') -Recurse -Force
    Copy-Item -Path $powershellAgentGoRoot -Destination (Join-Path $stagingRoot 'powershell-agent-go') -Recurse -Force
    Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $destinationPath -Force
    Write-Host "Package created: $destinationPath"
} finally {
    if (Test-Path $stagingRoot) {
        Remove-Item -Path $stagingRoot -Recurse -Force
    }
}
