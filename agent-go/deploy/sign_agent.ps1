param(
    [Parameter(Mandatory = $true)]
    [string]$PfxPath,

    [Parameter(Mandatory = $true)]
    [PSCredential]$SigningCredential,

    [string]$AgentExePath = (Join-Path $PSScriptRoot 'it-agent.exe'),
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $AgentExePath)) {
    throw "Agent executable not found: $AgentExePath"
}

if (-not (Test-Path $PfxPath)) {
    throw "PFX not found: $PfxPath"
}

$signtool = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin\x64\signtool.exe'
if (-not (Test-Path $signtool)) {
    throw "signtool.exe not found. Install Windows SDK signing tools."
}

$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SigningCredential.Password)
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
try {
    & $signtool sign /fd SHA256 /f $PfxPath /p $plainPassword /tr $TimestampUrl /td SHA256 $AgentExePath
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if ($LASTEXITCODE -ne 0) {
    throw "Code signing failed with exit code $LASTEXITCODE"
}

Write-Host "Agent successfully signed: $AgentExePath"
