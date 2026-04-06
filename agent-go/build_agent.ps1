param(
    [string]$OutputDir = ".\deploy"
)

$ErrorActionPreference = 'Stop'

Push-Location $PSScriptRoot
try {
    if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
        throw "Go SDK not found. Install Go and retry."
    }

    go mod tidy

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    go build -o (Join-Path $OutputDir 'it-agent.exe') .\cmd\it-agent

    if (-not (Test-Path (Join-Path $OutputDir 'config.json'))) {
        Copy-Item -Path .\deploy\config.json -Destination (Join-Path $OutputDir 'config.json') -Force
    }

    Write-Host "Build completed: $(Join-Path $OutputDir 'it-agent.exe')"
    Write-Host "Optional: sign binary with deploy\\sign_agent.ps1"
    Write-Host "Next step: run deploy\\install_service.ps1 as Administrator on client machines."
} finally {
    Pop-Location
}
