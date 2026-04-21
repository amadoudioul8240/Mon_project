param(
    [string]$BackendUrl = $(if ($env:ASSET_BACKEND_URL) { $env:ASSET_BACKEND_URL } else { 'http://192.168.196.134:8000/assets/scan' }),
    [string]$ExportPath = '',
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PrimaryIPv4 {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -First 1 -ExpandProperty IPAddress
        return $ip
    } catch {
        return ''
    }
}

function Get-MacAddress {
    try {
        $mac = Get-NetAdapter |
            Where-Object { $_.Status -eq 'Up' -and $_.MacAddress } |
            Select-Object -First 1 -ExpandProperty MacAddress
        if ($mac) {
            return ($mac -replace '-', ':').ToLower()
        }
    } catch {
    }
    return ''
}

function Get-SerialAndModel {
    $serial = ''
    $model = ''
    try {
        $bios = Get-CimInstance -ClassName Win32_BIOS
        if ($bios.SerialNumber) { $serial = $bios.SerialNumber.Trim() }
    } catch {
    }

    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem
        if ($cs.Model) { $model = $cs.Model.Trim() }
    } catch {
    }

    return @{ Serial = $serial; Model = $model }
}

function Get-PendingReboot {
    try {
        $paths = @(
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
        )
        foreach ($path in $paths) {
            if (Test-Path $path) {
                return $true
            }
        }
    } catch {
    }
    return $false
}

function Get-SecurityPosture {
    $firewallEnabled = $false
    $defenderEnabled = $false
    $realtimeProtectionEnabled = $false
    $bitlockerEnabled = $false

    try {
        $profiles = Get-NetFirewallProfile -ErrorAction Stop
        $firewallEnabled = @($profiles | Where-Object { $_.Enabled -eq $true }).Count -gt 0
    } catch {
    }

    try {
        $mp = Get-MpComputerStatus -ErrorAction Stop
        $defenderEnabled = [bool]$mp.AntivirusEnabled
        $realtimeProtectionEnabled = [bool]$mp.RealTimeProtectionEnabled
    } catch {
    }

    try {
        $bl = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop
        $bitlockerEnabled = $bl.ProtectionStatus -eq 'On' -or $bl.ProtectionStatus -eq 1
    } catch {
    }

    return [ordered]@{
        firewall_enabled = $firewallEnabled
        defender_enabled = $defenderEnabled
        realtime_protection_enabled = $realtimeProtectionEnabled
        bitlocker_enabled = $bitlockerEnabled
        pending_reboot = Get-PendingReboot
    }
}

function Get-ResourceMetrics {
    $cpuPercent = $null
    $ramTotalGB = $null
    $ramUsedGB = $null
    $diskTotalGB = $null
    $diskUsedGB = $null

    try {
        $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop |
            Measure-Object -Property LoadPercentage -Average
        if ($cpu.Average -ne $null) {
            $cpuPercent = [Math]::Round([double]$cpu.Average, 2)
        }
    } catch {
    }

    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $totalKB = [double]$os.TotalVisibleMemorySize
        $freeKB = [double]$os.FreePhysicalMemory
        if ($totalKB -gt 0) {
            $ramTotalGB = [Math]::Round($totalKB / 1MB, 2)
            $ramUsedGB = [Math]::Round(($totalKB - $freeKB) / 1MB, 2)
        }
    } catch {
    }

    try {
        $disks = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop
        $totalBytes = ($disks | Measure-Object -Property Size -Sum).Sum
        $freeBytes = ($disks | Measure-Object -Property FreeSpace -Sum).Sum
        if ($totalBytes -gt 0) {
            $diskTotalGB = [Math]::Round(([double]$totalBytes) / 1GB, 2)
            $diskUsedGB = [Math]::Round((([double]$totalBytes - [double]$freeBytes) / 1GB), 2)
        }
    } catch {
    }

    return [ordered]@{
        cpu_percent = $cpuPercent
        ram_total_gb = $ramTotalGB
        ram_used_gb = $ramUsedGB
        disk_total_gb = $diskTotalGB
        disk_used_gb = $diskUsedGB
    }
}

function Get-NetworkScan {
        <#
        .SYNOPSIS
        Scans the local network for reachable Windows hosts and collects their security posture.
        This is purely defensive: it discovers hosts via ICMP ping and collects their security status.
        #>
        param(
            [string]$LocalIPAddress = ''
        )

        if (-not $LocalIPAddress) {
            return @()
        }

        try {
            $ipParts = $LocalIPAddress -split '\.'
            if ($ipParts.Count -ne 4) {
                return @()
            }

            $subnet = "$($ipParts[0]).$($ipParts[1]).$($ipParts[2])"
            $discoveredHosts = @()

            # Sources d'adresses candidates : ARP/voisins + balayage borné pour détecter plusieurs hôtes.
            $neighborIps = @()
            try {
                $neighborIps = Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                    Where-Object {
                        $_.IPAddress -like "$subnet.*" -and
                        $_.IPAddress -ne $LocalIPAddress -and
                        $_.State -in @('Reachable', 'Stale', 'Permanent')
                    } |
                    Select-Object -ExpandProperty IPAddress
            } catch {
            }

            $sweepIps = 1..40 | ForEach-Object { "$subnet.$_" }
            $addressesToScan = @($neighborIps + $sweepIps) | Select-Object -Unique

            Write-Host "Démarrage du scan réseau défensif sur $subnet (max 40 adresses + voisins connus)..."
            foreach ($testIp in $addressesToScan) {
                try {
                    $ping = Test-Connection -ComputerName $testIp -Count 1 -TimeoutSeconds 2 -Quiet -ErrorAction SilentlyContinue
                    if ($ping) {
                        Write-Host "Hôte réactif détecté: $testIp"
                    
                        $hostname = ''
                        $os = ''
                        $serial = ''
                        $mac = ''
                        $fw = $false
                        $def = $false
                        $rt = $false
                        $bl = $false

                        # Try to get hostname via reverse DNS
                        try {
                            $dnsEntry = [System.Net.Dns]::GetHostEntry($testIp)
                            if ($dnsEntry) {
                                $hostname = $dnsEntry.HostName
                            }
                        } catch {
                        }

                        if (-not $hostname) {
                            $hostname = "Unknown-$testIp"
                        }

                        # Try to collect WMI data from remote host (requires network permissions)
                        try {
                            $remoteBios = Get-CimInstance -ClassName Win32_BIOS -ComputerName $testIp -ErrorAction SilentlyContinue -TimeoutSec 3
                            if ($remoteBios.SerialNumber) {
                                $serial = $remoteBios.SerialNumber.Trim()
                            }
                        } catch {
                        }

                        try {
                            $remoteCs = Get-CimInstance -ClassName Win32_ComputerSystem -ComputerName $testIp -ErrorAction SilentlyContinue -TimeoutSec 3
                            if ($remoteCs.SystemFamily) {
                                $os = $remoteCs.SystemFamily
                            }
                        } catch {
                        }

                        # Marque toujours les hôtes LAN comme sonde réseau pour la logique backend.
                        $serial = "NET-$testIp"

                        $discoveredHosts += [PSCustomObject]@{
                            hostname = $hostname
                            ip_address = $testIp
                            serial_number = $serial
                            os = "Network Probe"
                            firewall_enabled = $fw
                            defender_enabled = $def
                            realtime_protection_enabled = $rt
                            bitlocker_enabled = $bl
                            pending_reboot = $false
                        }
                    }
                } catch {
                    # Suppress individual host scan failures
                }
            }

            return $discoveredHosts | Select-Object -First 40
        } catch {
            Write-Warning "Network scan failed: $_"
            return @()
        }
}

function Get-OpenPortsForHost {
    param(
        [string]$HostOrIp
    )

    $commonPorts = @(22, 53, 80, 135, 139, 389, 443, 445, 636, 3389, 5985, 5986)
    $openPorts = @()

    foreach ($port in $commonPorts) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $async = $client.BeginConnect($HostOrIp, $port, $null, $null)
            $connected = $async.AsyncWaitHandle.WaitOne(400)
            if ($connected -and $client.Connected) {
                $openPorts += $port
            }
            $client.Close()
        } catch {
        }
    }
    return @($openPorts | Sort-Object -Unique)
}

function Get-RecentLocalLogs {
    $logs = @()
    try {
        $events = Get-WinEvent -LogName System -MaxEvents 8 -ErrorAction SilentlyContinue
        foreach ($evt in $events) {
            $msg = ($evt.Message -replace "`r`n", ' ')
            if ($msg.Length -gt 180) {
                $msg = $msg.Substring(0, 180) + '...'
            }
            $logs += ("{0} | ID:{1} | {2}" -f $evt.TimeCreated.ToString('s'), $evt.Id, $msg)
        }
    } catch {
    }
    return @($logs)
}

function Get-AuthCursorPath {
    return 'C:\ProgramData\ITMonitoringAgent\auth_cursor.json'
}

function Get-LastAuthRecordId {
    $path = Get-AuthCursorPath
    try {
        if (Test-Path $path) {
            $raw = Get-Content -Path $path -Raw -ErrorAction Stop
            $obj = $raw | ConvertFrom-Json
            if ($obj -and $obj.last_record_id -as [int]) {
                return [int]$obj.last_record_id
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
    param([int]$MaxEvents = 400)

    $lastRecord = Get-LastAuthRecordId
    $maxRecordSeen = $lastRecord
    $result = @()

    try {
        $events = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = @(4624, 4625, 4740); StartTime = (Get-Date).AddHours(-12) } -MaxEvents $MaxEvents -ErrorAction SilentlyContinue |
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
    }

    return @($result)
}

function Get-RecentDownloadEvents {
    param([int]$Minutes = 30)

    $threshold = (Get-Date).AddMinutes(-1 * [Math]::Abs($Minutes))
    $events = @()

    try {
        $profiles = Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notin @('Public', 'Default', 'Default User', 'All Users') }

        foreach ($profile in $profiles) {
            $downloadPath = Join-Path $profile.FullName 'Downloads'
            if (-not (Test-Path $downloadPath)) {
                continue
            }

            $recent = Get-ChildItem -Path $downloadPath -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -ge $threshold } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 50

            foreach ($file in $recent) {
                $events += [ordered]@{
                    path = $file.FullName
                    file_name = $file.Name
                    size_bytes = [int64]$file.Length
                    modified_at = $file.LastWriteTime.ToString('o')
                    user_name = $profile.Name
                }
            }
        }
    } catch {
    }

    return @($events)
}

function Get-RecentWebConnections {
    $events = @()

    try {
        $connections = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
            Where-Object { $_.RemotePort -in @(80, 443) } |
            Sort-Object RemoteAddress, RemotePort -Unique |
            Select-Object -First 60

        foreach ($conn in $connections) {
            $procName = ''
            try {
                $procName = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            } catch {
            }

            $domain = ''
            try {
                $hostEntry = [System.Net.Dns]::GetHostEntry($conn.RemoteAddress)
                if ($hostEntry -and $hostEntry.HostName) {
                    $domain = $hostEntry.HostName
                }
            } catch {
            }

            $events += [ordered]@{
                remote_ip = $conn.RemoteAddress
                remote_port = [int]$conn.RemotePort
                domain = $domain
                process_name = $procName
                protocol = 'tcp'
            }
        }
    } catch {
    }

    return @($events)
}

function Get-InstalledSoftware {
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )

    function Get-PropValue {
        param(
            [Parameter(Mandatory = $true)] $Object,
            [Parameter(Mandatory = $true)] [string]$Name
        )

        $prop = $Object.PSObject.Properties[$Name]
        if ($null -ne $prop -and $null -ne $prop.Value) {
            return [string]$prop.Value
        }
        return ''
    }

    $items = foreach ($path in $paths) {
        if (Test-Path $path) {
            Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
                Where-Object { (Get-PropValue -Object $_ -Name 'DisplayName') } |
                ForEach-Object {
                    [PSCustomObject]@{
                        name         = Get-PropValue -Object $_ -Name 'DisplayName'
                        version      = Get-PropValue -Object $_ -Name 'DisplayVersion'
                        publisher    = Get-PropValue -Object $_ -Name 'Publisher'
                        install_date = Get-PropValue -Object $_ -Name 'InstallDate'
                        license_key = ''
                    }
                }
        }
    }

    # Déduplication simple par nom+version pour éviter les doublons multi-registre.
    $dedup = $items |
        Group-Object -Property { "{0}|{1}" -f $_.name, $_.version } |
        ForEach-Object { $_.Group | Select-Object -First 1 } |
        Sort-Object -Property name

    return @($dedup)
}

try {
    $serialAndModel = Get-SerialAndModel

    $payload = [ordered]@{
        hostname      = $env:COMPUTERNAME
        os            = 'Windows'
        os_version    = [System.Environment]::OSVersion.VersionString
        ip            = Get-PrimaryIPv4
        serial_number = $serialAndModel.Serial
        model         = $serialAndModel.Model
        mac           = Get-MacAddress
        software      = Get-InstalledSoftware
    }

    $securityPosture = [ordered]@{
        hostname = $payload.hostname
        serial_number = $payload.serial_number
        ip_address = $payload.ip
        source = 'local_agent'
        os = $payload.os
    }
    (Get-SecurityPosture).GetEnumerator() | ForEach-Object {
        $securityPosture[$_.Key] = $_.Value
    }

    $resourceMetrics = [ordered]@{
        hostname = $payload.hostname
        serial_number = $payload.serial_number
        source = 'local_agent'
    }
    (Get-ResourceMetrics).GetEnumerator() | ForEach-Object {
        $resourceMetrics[$_.Key] = $_.Value
    }

    $networkTelemetryHosts = @()
    $networkTelemetryHosts += [ordered]@{
        serial_number = $payload.serial_number
        hostname = $payload.hostname
        ip_address = $payload.ip
        source = 'local_agent'
        open_ports = Get-OpenPortsForHost -HostOrIp $payload.hostname
        logs = Get-RecentLocalLogs
    }

    if (-not $payload.serial_number) {
        Write-Warning 'Numéro de série introuvable. Utilisation du hostname comme fallback.'
        $payload.serial_number = $payload.hostname
    }

    if ($ExportPath) {
        $payload | ConvertTo-Json -Depth 6 | Set-Content -Path $ExportPath -Encoding UTF8
        Write-Host "Export JSON généré: $ExportPath"
    }

    if ($DryRun) {
        Write-Host 'Mode DryRun: aucune requête envoyée.'
        $payload | ConvertTo-Json -Depth 4
        exit 0
    }

    $body = $payload | ConvertTo-Json -Depth 6
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $response = Invoke-RestMethod -Uri $BackendUrl -Method Post -Body $bodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 20

    $securityUrl = $BackendUrl -replace '/assets/scan$', '/security/posture'
    $securityBody = $securityPosture | ConvertTo-Json -Depth 4
    $securityBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($securityBody)
    Invoke-RestMethod -Uri $securityUrl -Method Post -Body $securityBodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 20 | Out-Null

    $metricsUrl = $BackendUrl -replace '/assets/scan$', '/metrics/resources'
    $metricsBody = $resourceMetrics | ConvertTo-Json -Depth 4
    $metricsBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($metricsBody)
    Invoke-RestMethod -Uri $metricsUrl -Method Post -Body $metricsBodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 20 | Out-Null

    Write-Host "Envoi réussi vers $BackendUrl"
    Write-Host ("Asset ID: {0} | Créé: {1} | Logiciels: {2}" -f $response.asset_id, $response.created, $response.software_count)

    # Découvre et enregistre les postures des autres hôtes du LAN
    $networkHosts = Get-NetworkScan -LocalIPAddress $payload.ip
    foreach ($host in $networkHosts) {
        try {
            $networkPosture = [ordered]@{
                hostname = $host.hostname
                serial_number = $host.serial_number
                ip_address = $host.ip_address
                source = 'lan_probe'
                os = $host.os
                firewall_enabled = $host.firewall_enabled
                defender_enabled = $host.defender_enabled
                realtime_protection_enabled = $host.realtime_protection_enabled
                bitlocker_enabled = $host.bitlocker_enabled
                pending_reboot = $host.pending_reboot
            }
            $networkBody = $networkPosture | ConvertTo-Json -Depth 4
            $networkBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($networkBody)
            Invoke-RestMethod -Uri $securityUrl -Method Post -Body $networkBodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 20 -ErrorAction SilentlyContinue | Out-Null

            $networkTelemetryHosts += [ordered]@{
                serial_number = $host.serial_number
                hostname = $host.hostname
                ip_address = $host.ip_address
                source = 'lan_probe'
                open_ports = Get-OpenPortsForHost -HostOrIp $host.ip_address
                logs = @("Probe LAN $(Get-Date -Format s): hôte actif détecté", "IP: $($host.ip_address)")
            }

            Write-Host "Posture LAN enregistrée pour $($host.hostname)"
        } catch {
            Write-Host "Impossible d'enregistrer la posture pour $($host.hostname): $_" -ForegroundColor Yellow
        }
    }

    $networkTelemetryUrl = $BackendUrl -replace '/assets/scan$', '/network/telemetry'
    $networkTelemetryPayload = [ordered]@{ hosts = $networkTelemetryHosts }
    $networkTelemetryBody = $networkTelemetryPayload | ConvertTo-Json -Depth 6
    $networkTelemetryBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($networkTelemetryBody)
    Invoke-RestMethod -Uri $networkTelemetryUrl -Method Post -Body $networkTelemetryBodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 | Out-Null

    $authEvents = Get-RecentAuthEvents
    if (@($authEvents).Count -gt 0) {
        $authUrl = $BackendUrl -replace '/assets/scan$', '/siem/auth-events'
        $authPayload = [ordered]@{
            host_serial = $payload.serial_number
            host_name = $payload.hostname
            host_ip = $payload.ip
            source = 'local_agent'
            events = $authEvents
        }
        $authBody = $authPayload | ConvertTo-Json -Depth 8
        $authBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($authBody)
        Invoke-RestMethod -Uri $authUrl -Method Post -Body $authBodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 | Out-Null
    }

    $downloadEvents = Get-RecentDownloadEvents -Minutes 30
    if (@($downloadEvents).Count -gt 0) {
        $downloadUrl = $BackendUrl -replace '/assets/scan$', '/siem/download-events'
        $downloadPayload = [ordered]@{
            host_serial = $payload.serial_number
            host_name = $payload.hostname
            host_ip = $payload.ip
            source = 'local_agent'
            events = $downloadEvents
        }
        $downloadBody = $downloadPayload | ConvertTo-Json -Depth 8
        $downloadBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($downloadBody)
        Invoke-RestMethod -Uri $downloadUrl -Method Post -Body $downloadBodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 | Out-Null
    }

    $webEvents = Get-RecentWebConnections
    if (@($webEvents).Count -gt 0) {
        $webUrl = $BackendUrl -replace '/assets/scan$', '/siem/web-events'
        $webPayload = [ordered]@{
            host_serial = $payload.serial_number
            host_name = $payload.hostname
            host_ip = $payload.ip
            source = 'local_agent'
            events = $webEvents
        }
        $webBody = $webPayload | ConvertTo-Json -Depth 8
        $webBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($webBody)
        Invoke-RestMethod -Uri $webUrl -Method Post -Body $webBodyBytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 | Out-Null
    }

    exit 0
} catch {
    $details = ''
    $response = $null
    if ($_.Exception -and $_.Exception.PSObject.Properties['Response']) {
        $response = $_.Exception.Response
    }
    if ($null -ne $response) {
        try {
            $stream = $response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                try {
                    $details = $reader.ReadToEnd()
                } finally {
                    $reader.Dispose()
                    $stream.Dispose()
                }
            }
        } catch {
        }
    }
    if ($details) {
        Write-Error ("Erreur lors de la collecte/envoi: {0} | Détails API: {1}" -f $_.Exception.Message, $details)
    } else {
        Write-Error ("Erreur lors de la collecte/envoi: {0}" -f $_.Exception.Message)
    }
    exit 1
}
