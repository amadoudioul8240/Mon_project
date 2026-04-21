param(
    [Parameter(Mandatory = $true)]
    [string]$SourceSharePath,

    [string]$LocalAgentDir = "C:\ProgramData\ITMonitoringAgent",
    [string]$ServiceName = "ITMonitoringGoAgent",
    [string]$BackendUrl = "",
    [int]$StartDelaySeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message)

    $logPath = Join-Path $env:ProgramData 'ITMonitoringAgent\gpo-startup.log'
    New-Item -ItemType Directory -Path (Split-Path $logPath) -Force | Out-Null
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Confirm-SourceFiles {
    param([string]$BasePath)

    $required = @('it-agent.exe', 'config.json')
    foreach ($name in $required) {
        $p = Join-Path $BasePath $name
        if (-not (Test-Path $p)) {
            throw "Missing required file in source share: $p"
        }
    }
}

function Update-ConfigBackend {
    param(
        [string]$ConfigPath,
        [string]$Url
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return
    }

    $cfg = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    $cfg.backend_url = $Url
    $cfg | ConvertTo-Json -Depth 6 | Set-Content -Path $ConfigPath -Encoding UTF8
}

function Install-Or-UpdateService {
    param(
        [string]$Name,
        [string]$ExePath
    )

    $binPath = "`"$ExePath`" -service"
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue

    if (-not $svc) {
        Write-Log "Creating service $Name"
        sc.exe create $Name binPath= $binPath start= auto DisplayName= "IT Monitoring Go Agent" | Out-Null
        sc.exe description $Name "Collects IT metrics and security telemetry for IT Monitoring backend" | Out-Null
    } else {
        Write-Log "Updating service $Name binary path"
        sc.exe config $Name binPath= $binPath start= auto | Out-Null
    }

    try {
        sc.exe stop $Name | Out-Null
        Start-Sleep -Seconds 1
    } catch {
    }

    sc.exe start $Name | Out-Null
}

try {
    if ($StartDelaySeconds -gt 0) {
        Start-Sleep -Seconds $StartDelaySeconds
    }

    Write-Log "GPO startup deployment started"
    Confirm-SourceFiles -BasePath $SourceSharePath

    New-Item -ItemType Directory -Path $LocalAgentDir -Force | Out-Null

    $sourceExe = Join-Path $SourceSharePath 'it-agent.exe'
    $sourceCfg = Join-Path $SourceSharePath 'config.json'
    $targetExe = Join-Path $LocalAgentDir 'it-agent.exe'
    $targetCfg = Join-Path $LocalAgentDir 'config.json'

    Copy-Item -Path $sourceExe -Destination $targetExe -Force
    Copy-Item -Path $sourceCfg -Destination $targetCfg -Force

    Update-ConfigBackend -ConfigPath $targetCfg -Url $BackendUrl
    Install-Or-UpdateService -Name $ServiceName -ExePath $targetExe

    Write-Log "GPO startup deployment completed successfully"
} catch {
    Write-Log ("ERROR: " + $_.Exception.Message)
    exit 1
}
