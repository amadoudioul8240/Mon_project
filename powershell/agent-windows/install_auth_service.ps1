param(
    [string]$InstallDir = 'C:\ProgramData\ITMonitoringAuthAgent',
    [string]$ServiceName = 'ITMonitoringWindowsAuthAgent',
    [string]$AuthUrl = $(if ($env:AUTH_EVENTS_URL) { $env:AUTH_EVENTS_URL } else { 'http://192.168.196.134:8000/siem/auth-events' }),
    [int]$IntervalSeconds = 60
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

$sourceScript = Join-Path $PSScriptRoot 'agent_auth_collect.ps1'
$targetScript = Join-Path $InstallDir 'agent_auth_collect.ps1'
Copy-Item -Path $sourceScript -Destination $targetScript -Force

$binPath = '"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Loop -IntervalSeconds {2} -AuthUrl "{3}"' -f $PSHOME.Replace('System32\WindowsPowerShell\v1.0', 'System32\WindowsPowerShell\v1.0\powershell.exe'), $targetScript, $IntervalSeconds, $AuthUrl

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= 'IT Monitoring Windows Auth Agent' | Out-Null
sc.exe description $ServiceName 'Collects only Windows authentication events for IT Monitoring SIEM' | Out-Null
sc.exe start $ServiceName | Out-Null

Write-Host "Windows auth-only service installed and started: $ServiceName"
Write-Host "Agent path: $targetScript"