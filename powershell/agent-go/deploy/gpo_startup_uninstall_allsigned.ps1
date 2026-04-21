param(
    [Parameter(Mandatory = $true)]
    [string]$TrustedSignerThumbprint,

    [string]$ServiceName = "ITMonitoringGoAgent",
    [string]$LocalAgentDir = "C:\ProgramData\ITMonitoringAgent",
    [switch]$KeepFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message)

    $logPath = Join-Path $env:ProgramData 'ITMonitoringAgent\gpo-startup-allsigned.log'
    New-Item -ItemType Directory -Path (Split-Path $logPath) -Force | Out-Null
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Format-Thumbprint {
    param([string]$Thumbprint)

    return (($Thumbprint -replace ' ', '')).ToUpperInvariant()
}

function Assert-Signature {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedThumbprint
    )

    if (-not (Test-Path $Path)) {
        throw "File not found: $Path"
    }

    $sig = Get-AuthenticodeSignature -FilePath $Path
    if ($sig.Status -ne 'Valid') {
        throw "Invalid signature for $Path. Status: $($sig.Status) - $($sig.StatusMessage)"
    }

    $actual = Format-Thumbprint -Thumbprint $sig.SignerCertificate.Thumbprint
    $expected = Format-Thumbprint -Thumbprint $ExpectedThumbprint
    if ($actual -ne $expected) {
        throw "Unexpected signer for $Path. Expected thumbprint $expected but got $actual"
    }
}

try {
    Write-Log "GPO AllSigned startup uninstall started"
    Assert-Signature -Path $PSCommandPath -ExpectedThumbprint $TrustedSignerThumbprint

    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        try {
            sc.exe stop $ServiceName | Out-Null
            Start-Sleep -Seconds 1
        } catch {
        }

        sc.exe delete $ServiceName | Out-Null
        Write-Log "Service removed: $ServiceName"
    } else {
        Write-Log "Service not found: $ServiceName"
    }

    if (-not $KeepFiles -and (Test-Path $LocalAgentDir)) {
        Remove-Item -Path $LocalAgentDir -Recurse -Force
        Write-Log "Removed local agent directory: $LocalAgentDir"
    }

    Write-Log "GPO AllSigned startup uninstall completed successfully"
} catch {
    Write-Log ("ERROR: " + $_.Exception.Message)
    exit 1
}
