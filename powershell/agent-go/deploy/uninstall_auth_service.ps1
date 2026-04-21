param(
    [string]$ServiceName = "ITMonitoringGoAuthAgent"
)

$ErrorActionPreference = 'Continue'

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    sc.exe delete $ServiceName | Out-Null
    Write-Host "Service removed: $ServiceName"
} else {
    Write-Host "Service not found: $ServiceName"
}