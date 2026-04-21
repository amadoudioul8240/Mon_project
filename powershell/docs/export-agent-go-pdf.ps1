param(
    [string]$HtmlPath = "..\..\docs\agent-go-deployment.html",
    [string]$PdfPath = ".\Agent-Go-Deployment.pdf"
)

$ErrorActionPreference = 'Stop'

function Resolve-ExistingInputPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return [System.IO.Path]::GetFullPath($PathValue)
    }

    $candidates = @(
        (Join-Path (Get-Location).Path $PathValue),
        (Join-Path $PSScriptRoot $PathValue)
    )

    foreach ($candidate in $candidates) {
        $full = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path $full) {
            return $full
        }
    }

    return [System.IO.Path]::GetFullPath($candidates[0])
}

function Resolve-OutputPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return [System.IO.Path]::GetFullPath($PathValue)
    }

    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $PathValue))
}

$htmlFull = Resolve-ExistingInputPath -PathValue $HtmlPath
$pdfFull = Resolve-OutputPath -PathValue $PdfPath

if (-not (Test-Path $htmlFull)) {
    throw "HTML source not found: $htmlFull"
}

$browsers = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe")
)

$browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
    throw "No compatible browser found (Edge/Chrome)"
}

$fileUrl = "file:///" + ($htmlFull -replace '\\', '/')

if (Test-Path $pdfFull) {
    Remove-Item $pdfFull -Force
}

& $browser --headless --disable-gpu --print-to-pdf="$pdfFull" "$fileUrl"
Start-Sleep -Seconds 2

if (-not (Test-Path $pdfFull)) {
    throw "PDF generation failed. Check browser policy restrictions."
}

Write-Host "PDF generated: $pdfFull"
