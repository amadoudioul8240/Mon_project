param(
    [string]$Destination = "..\agent-go-package.zip"
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$destinationPath = [System.IO.Path]::GetFullPath((Join-Path $root $Destination))

if (Test-Path $destinationPath) {
    Remove-Item $destinationPath -Force
}

Compress-Archive -Path (Join-Path $root '*') -DestinationPath $destinationPath -Force
Write-Host "Package created: $destinationPath"
