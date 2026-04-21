param(
    [Parameter(Mandatory = $true)]
    [string]$ComputerListPath,

    [string]$ServiceName = "ITMonitoringGoAgent",
    [string]$RemoteAgentDir = "C$\ProgramData\ITMonitoringAgent",
    [string]$BackendUrl = "",
    [switch]$SkipOffline
)

$ErrorActionPreference = 'Stop'

function Read-ComputerList {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Computer list not found: $Path"
    }

    return Get-Content -Path $Path |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('#') } |
        Select-Object -Unique
}

function Update-BackendUrlInConfig {
    param(
        [string]$ConfigPath,
        [string]$Url
    )

    if (-not $Url) {
        return
    }

    $cfg = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    $cfg.backend_url = $Url
    $cfg | ConvertTo-Json -Depth 6 | Set-Content -Path $ConfigPath -Encoding UTF8
}

$deployRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path (Split-Path (Split-Path $deployRoot -Parent) -Parent) -Parent
$repoDeployDir = Join-Path $repoRoot 'agent-go\deploy'
$agentExe = Join-Path $deployRoot 'it-agent.exe'
$configJson = Join-Path $deployRoot 'config.json'
$installScript = Join-Path $deployRoot 'install_service.ps1'

if (-not (Test-Path $agentExe)) {
    $agentExe = Join-Path $repoDeployDir 'it-agent.exe'
}
if (-not (Test-Path $configJson)) {
    $configJson = Join-Path $repoDeployDir 'config.json'
}

if (-not (Test-Path $agentExe)) {
    throw "Missing it-agent.exe in deploy folder. Run build_agent.ps1 first."
}
if (-not (Test-Path $configJson)) {
    throw "Missing config.json in deploy folder."
}
if (-not (Test-Path $installScript)) {
    throw "Missing install_service.ps1 in deploy folder."
}

Update-BackendUrlInConfig -ConfigPath $configJson -Url $BackendUrl

$computers = Read-ComputerList -Path $ComputerListPath
if ($computers.Count -eq 0) {
    throw "No computers found in list."
}

$results = [System.Collections.Generic.List[object]]::new()

foreach ($computer in $computers) {
    Write-Host "--- $computer ---" -ForegroundColor Cyan

    try {
        $online = Test-Connection -ComputerName $computer -Count 1 -Quiet -ErrorAction SilentlyContinue
        if (-not $online) {
            $message = "Offline"
            if (-not $SkipOffline) {
                throw $message
            }
            $results.Add([pscustomobject]@{ Computer = $computer; Status = 'Skipped'; Detail = $message })
            Write-Warning "$computer offline, skipped."
            continue
        }

        $remotePath = "\\$computer\\$RemoteAgentDir"
        if (-not (Test-Path $remotePath)) {
            New-Item -ItemType Directory -Path $remotePath -Force | Out-Null
        }

        Copy-Item -Path $agentExe -Destination (Join-Path $remotePath 'it-agent.exe') -Force
        Copy-Item -Path $configJson -Destination (Join-Path $remotePath 'config.json') -Force
        Copy-Item -Path $installScript -Destination (Join-Path $remotePath 'install_service.ps1') -Force

        Invoke-Command -ComputerName $computer -ScriptBlock {
            param($agentDir)
            Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
            & "$agentDir\install_service.ps1" -AgentDir ("C:\ProgramData\ITMonitoringAgent")
        } -ArgumentList "C:\ProgramData\ITMonitoringAgent"

        $results.Add([pscustomobject]@{ Computer = $computer; Status = 'Success'; Detail = 'Installed/Updated' })
        Write-Host "$computer OK" -ForegroundColor Green
    }
    catch {
        $detail = $_.Exception.Message
        $results.Add([pscustomobject]@{ Computer = $computer; Status = 'Error'; Detail = $detail })
        Write-Host "$computer ERROR: $detail" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Deployment summary" -ForegroundColor Yellow
$results | Format-Table -AutoSize
