param(
    [string]$AuthUrl = $(
        if ($env:AUTH_EVENTS_URL) {
            $env:AUTH_EVENTS_URL
        } elseif ($env:ASSET_BACKEND_URL) {
            $env:ASSET_BACKEND_URL -replace '/assets/scan$', '/siem/auth-events'
        } else {
            'http://192.168.196.134:8000/siem/auth-events'
        }
    ),
    [int]$IntervalSeconds = 60,
    [int]$MaxEvents = 400,
    [string]$StateDir = 'C:\ProgramData\ITMonitoringAuthAgent',
    [switch]$Loop,
    [switch]$DryRun,
    [switch]$VerboseOutput
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PrimaryIPv4 {
    try {
        return Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -First 1 -ExpandProperty IPAddress
    } catch {
        return ''
    }
}

function Get-SerialNumber {
    try {
        $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop
        if ($bios.SerialNumber) {
            return $bios.SerialNumber.Trim()
        }
    } catch {
    }
    return $env:COMPUTERNAME
}

function Get-AuthCursorPath {
    return Join-Path $StateDir 'auth_cursor.json'
}

function Get-LastAuthRecordId {
    $path = Get-AuthCursorPath
    try {
        if (Test-Path $path) {
            $data = Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $data.last_record_id) {
                return [int]$data.last_record_id
            }
        }
    } catch {
    }
    return 0
}

function Save-LastAuthRecordId {
    param([int]$RecordId)

    $path = Get-AuthCursorPath
    try {
        New-Item -ItemType Directory -Path (Split-Path -Path $path) -Force | Out-Null
        $body = @{ last_record_id = $RecordId; updated_at = (Get-Date).ToString('s') } | ConvertTo-Json
        Set-Content -Path $path -Value $body -Encoding UTF8
    } catch {
    }
}

function Get-RecentAuthEvents {
    param([int]$Limit = 400)

    $lastRecord = Get-LastAuthRecordId
    $maxRecordSeen = $lastRecord
    $result = @()

    try {
        $events = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = @(4624, 4625, 4740); StartTime = (Get-Date).AddHours(-12) } -MaxEvents $Limit -ErrorAction SilentlyContinue |
            Sort-Object RecordId

        foreach ($evt in $events) {
            if ($evt.RecordId -le $lastRecord) {
                continue
            }

            if ($evt.RecordId -gt $maxRecordSeen) {
                $maxRecordSeen = $evt.RecordId
            }

            $xml = [xml]$evt.ToXml()
            $eventData = @{}
            foreach ($node in $xml.Event.EventData.Data) {
                $eventData[$node.Name] = [string]$node.'#text'
            }

            $outcome = 'unknown'
            if ($evt.Id -eq 4624) { $outcome = 'success' }
            elseif ($evt.Id -eq 4625) { $outcome = 'failure' }
            elseif ($evt.Id -eq 4740) { $outcome = 'lockout' }

            $user = ''
            if ($eventData.ContainsKey('TargetUserName')) { $user = $eventData['TargetUserName'] }
            if (-not $user -and $eventData.ContainsKey('SubjectUserName')) { $user = $eventData['SubjectUserName'] }

            $domain = if ($eventData.ContainsKey('TargetDomainName')) { $eventData['TargetDomainName'] } else { '' }
            $ip = if ($eventData.ContainsKey('IpAddress')) { $eventData['IpAddress'] } elseif ($eventData.ContainsKey('CallerComputerName')) { $eventData['CallerComputerName'] } else { '' }
            $logonType = if ($eventData.ContainsKey('LogonType')) { $eventData['LogonType'] } else { '' }

            $msg = ($evt.Message -replace "`r`n", ' ')
            if ($msg.Length -gt 240) { $msg = $msg.Substring(0, 240) + '...' }

            $result += [ordered]@{
                record_id = [int]$evt.RecordId
                event_id = [int]$evt.Id
                timestamp = $evt.TimeCreated.ToString('o')
                user_name = $user
                domain = $domain
                source_ip = $ip
                logon_type = $logonType
                outcome = $outcome
                message = $msg
            }
        }

        if ($maxRecordSeen -gt $lastRecord) {
            Save-LastAuthRecordId -RecordId $maxRecordSeen
        }
    } catch {
        if ($VerboseOutput) {
            Write-Warning "Auth collection failed: $_"
        }
    }

    return @($result)
}

function Send-AuthEvents {
    param([array]$Events)

    $payload = [ordered]@{
        host_serial = Get-SerialNumber
        host_name = $env:COMPUTERNAME
        host_ip = Get-PrimaryIPv4
        source = 'windows_auth_agent'
        events = $Events
    }

    if ($DryRun) {
        $payload | ConvertTo-Json -Depth 8
        return $true
    }

    $body = $payload | ConvertTo-Json -Depth 8
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Uri $AuthUrl -Method Post -Body $bodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 | Out-Null
    return $true
}

function Invoke-AuthCycle {
    $events = Get-RecentAuthEvents -Limit $MaxEvents
    if ($VerboseOutput) {
        Write-Host ("[auth-only] collected {0} event(s)" -f @($events).Count)
    }

    if (@($events).Count -eq 0) {
        return $true
    }

    try {
        Send-AuthEvents -Events $events | Out-Null
        if ($VerboseOutput) {
            Write-Host ("[auth-only] sent {0} event(s) to {1}" -f @($events).Count, $AuthUrl)
        }
        return $true
    } catch {
        Write-Warning "Auth send failed: $_"
        return $false
    }
}

if (-not $Loop) {
    if (Invoke-AuthCycle) {
        exit 0
    }
    exit 1
}

while ($true) {
    Invoke-AuthCycle | Out-Null
    Start-Sleep -Seconds ([Math]::Max(30, $IntervalSeconds))
}