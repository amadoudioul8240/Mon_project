param(
    [Parameter(Mandatory = $true)]
    [string]$CertThumbprint,

    [ValidateSet('CurrentUser', 'LocalMachine')]
    [string]$StoreLocation = 'CurrentUser',

    [string]$TimestampUrl = 'http://timestamp.digicert.com',

    [string[]]$ScriptPaths = @(
        (Join-Path $PSScriptRoot 'install_service.ps1'),
        (Join-Path $PSScriptRoot 'uninstall_service.ps1'),
        (Join-Path $PSScriptRoot 'install_auth_service.ps1'),
        (Join-Path $PSScriptRoot 'uninstall_auth_service.ps1'),
        (Join-Path $PSScriptRoot 'deploy_bulk.ps1'),
        (Join-Path $PSScriptRoot 'gpo_startup_install.ps1'),
        (Join-Path $PSScriptRoot 'gpo_startup_install_allsigned.ps1'),
        (Join-Path $PSScriptRoot 'gpo_startup_uninstall_allsigned.ps1'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'build_agent.ps1'),
        (Join-Path (Split-Path $PSScriptRoot -Parent) 'make_package.ps1')
    ),

    [string]$AgentExePath = '',
    [string]$AuthAgentExePath = ''
)

$ErrorActionPreference = 'Stop'

if (-not $AgentExePath) {
    $repoRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
    $AgentExePath = Join-Path $repoRoot 'agent-go\deploy\it-agent.exe'
    $AuthAgentExePath = Join-Path $repoRoot 'agent-go\deploy\it-auth-agent.exe'
}

if (-not $AuthAgentExePath) {
    $repoRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
    $AuthAgentExePath = Join-Path $repoRoot 'agent-go\deploy\it-auth-agent.exe'
}

function Get-CodeSigningCert {
    param(
        [string]$Thumbprint,
        [string]$Location
    )

    $storePath = "Cert:\$Location\My"
    $cert = Get-ChildItem -Path $storePath |
        Where-Object {
            ($_.Thumbprint -replace ' ', '') -ieq ($Thumbprint -replace ' ', '') -and
            $_.HasPrivateKey -and
            $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3'
        } |
        Select-Object -First 1

    if (-not $cert) {
        throw "Code signing certificate not found in $storePath for thumbprint: $Thumbprint"
    }

    return $cert
}

$cert = Get-CodeSigningCert -Thumbprint $CertThumbprint -Location $StoreLocation

# Sign PowerShell scripts first so deployment execution policy checks pass.
foreach ($scriptPath in $ScriptPaths) {
    if (-not (Test-Path $scriptPath)) {
        throw "File not found: $scriptPath"
    }

    $sig = Set-AuthenticodeSignature -FilePath $scriptPath -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
    if ($sig.Status -notin @('Valid', 'UnknownError')) {
        throw "Failed to sign $scriptPath. Status: $($sig.Status) - $($sig.StatusMessage)"
    }

    Write-Host "Signed: $scriptPath"
}

# Sign executable if present.
if (Test-Path $AgentExePath) {
    $sigExe = Set-AuthenticodeSignature -FilePath $AgentExePath -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
    if ($sigExe.Status -notin @('Valid', 'UnknownError')) {
        throw "Failed to sign $AgentExePath. Status: $($sigExe.Status) - $($sigExe.StatusMessage)"
    }

    Write-Host "Signed: $AgentExePath"
} else {
    Write-Warning "Executable not found, skipped: $AgentExePath"
}

if (Test-Path $AuthAgentExePath) {
    $sigAuthExe = Set-AuthenticodeSignature -FilePath $AuthAgentExePath -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
    if ($sigAuthExe.Status -notin @('Valid', 'UnknownError')) {
        throw "Failed to sign $AuthAgentExePath. Status: $($sigAuthExe.Status) - $($sigAuthExe.StatusMessage)"
    }

    Write-Host "Signed: $AuthAgentExePath"
} else {
    Write-Warning "Executable not found, skipped: $AuthAgentExePath"
}

Write-Host 'Signing completed successfully.'
