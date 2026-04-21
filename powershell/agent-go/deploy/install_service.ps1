param(
    [string]$AgentDir = "C:\ProgramData\ITMonitoringAgent",
    [string]$ServiceName = "ITMonitoringGoAgent"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$repoDeployDir = Join-Path $repoRoot 'agent-go\deploy'

New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null

$sourceExe = Join-Path $PSScriptRoot 'it-agent.exe'
$sourceCfg = Join-Path $PSScriptRoot 'config.json'
if (-not (Test-Path $sourceExe)) {
    $sourceExe = Join-Path $repoDeployDir 'it-agent.exe'
}
if (-not (Test-Path $sourceCfg)) {
    $sourceCfg = Join-Path $repoDeployDir 'config.json'
}
$targetExe = Join-Path $AgentDir 'it-agent.exe'
$targetCfg = Join-Path $AgentDir 'config.json'

if (-not (Test-Path $sourceExe)) {
    throw "Missing it-agent.exe in deploy folder. Build the agent first."
}

Copy-Item -Path $sourceExe -Destination $targetExe -Force
if (Test-Path $sourceCfg) {
    Copy-Item -Path $sourceCfg -Destination $targetCfg -Force
}

$binPath = "`"$targetExe`" -service"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "IT Monitoring Go Agent" | Out-Null
sc.exe description $ServiceName "Collects IT metrics and security telemetry for IT Monitoring backend" | Out-Null
sc.exe start $ServiceName | Out-Null

Write-Host "Service installed and started: $ServiceName"
Write-Host "Agent path: $targetExe"
