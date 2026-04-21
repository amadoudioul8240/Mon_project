param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$agentGoRoot = Join-Path $repoRoot 'agent-go'
if (-not $OutputDir) {
    $OutputDir = Join-Path $agentGoRoot 'deploy'
}

Push-Location $agentGoRoot
try {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
        throw "Go SDK not found. Install Go and retry."
    }

    go mod tidy

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    go build -o (Join-Path $OutputDir 'it-agent.exe') .\cmd\it-agent
    go build -o (Join-Path $OutputDir 'it-auth-agent.exe') .\cmd\it-auth-agent

    if (-not (Test-Path (Join-Path $OutputDir 'config.json'))) {
        Copy-Item -Path (Join-Path $agentGoRoot 'deploy\config.json') -Destination (Join-Path $OutputDir 'config.json') -Force
    }

    Write-Host "Build completed: $(Join-Path $OutputDir 'it-agent.exe')"
    Write-Host "Build completed: $(Join-Path $OutputDir 'it-auth-agent.exe')"
    Write-Host "Optional: sign binary with powershell\\agent-go\\deploy\\sign_agent.ps1"
    Write-Host "Next step: run powershell\\agent-go\\deploy\\install_service.ps1 or install_auth_service.ps1 as Administrator on client machines."
} finally {
    Pop-Location
}
