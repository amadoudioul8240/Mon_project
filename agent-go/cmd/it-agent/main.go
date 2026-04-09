package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows/svc"
)

type Config struct {
	BackendURL      string `json:"backend_url"`
	IntervalSeconds int    `json:"interval_seconds"`
	AgentVersion    string `json:"agent_version"`
	ProxyURL        string `json:"proxy_url"`
	LogPath         string `json:"log_path"`
}

type AssetPayload struct {
	Hostname     string         `json:"hostname"`
	OS           string         `json:"os"`
	OSVersion    string         `json:"os_version"`
	IP           string         `json:"ip"`
	SerialNumber string         `json:"serial_number"`
	Model        string         `json:"model"`
	Mac          string         `json:"mac"`
	Software     []SoftwareItem `json:"software"`
}

type SoftwareItem struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Publisher   string `json:"publisher,omitempty"`
	InstallDate string `json:"install_date,omitempty"`
	LicenseKey  string `json:"license_key,omitempty"`
}

type SecurityPayload struct {
	Hostname                  string `json:"hostname"`
	SerialNumber              string `json:"serial_number"`
	IPAddress                 string `json:"ip_address"`
	Source                    string `json:"source"`
	AgentSource               string `json:"agent_source"`
	AgentVersion              string `json:"agent_version"`
	AgentID                   string `json:"agent_id"`
	OS                        string `json:"os"`
	FirewallEnabled           bool   `json:"firewall_enabled"`
	DefenderEnabled           bool   `json:"defender_enabled"`
	RealtimeProtectionEnabled bool   `json:"realtime_protection_enabled"`
	BitlockerEnabled          bool   `json:"bitlocker_enabled"`
	PendingReboot             bool   `json:"pending_reboot"`
}

type ResourcePayload struct {
	SerialNumber string   `json:"serial_number"`
	Hostname     string   `json:"hostname"`
	Source       string   `json:"source"`
	AgentSource  string   `json:"agent_source"`
	AgentVersion string   `json:"agent_version"`
	AgentID      string   `json:"agent_id"`
	CPUPercent   *float64 `json:"cpu_percent"`
	RAMTotalGB   *float64 `json:"ram_total_gb"`
	RAMUsedGB    *float64 `json:"ram_used_gb"`
	DiskTotalGB  *float64 `json:"disk_total_gb"`
	DiskUsedGB   *float64 `json:"disk_used_gb"`
}

type NetworkHost struct {
	SerialNumber string   `json:"serial_number"`
	Hostname     string   `json:"hostname"`
	IPAddress    string   `json:"ip_address"`
	Source       string   `json:"source"`
	AgentSource  string   `json:"agent_source"`
	AgentVersion string   `json:"agent_version"`
	AgentID      string   `json:"agent_id"`
	OpenPorts    []int    `json:"open_ports"`
	Logs         []string `json:"logs"`
}

type NetworkPayload struct {
	Hosts []NetworkHost `json:"hosts"`
}

type AuthEventItem struct {
	RecordID  int    `json:"record_id,omitempty"`
	EventID   int    `json:"event_id"`
	Timestamp string `json:"timestamp,omitempty"`
	UserName  string `json:"user_name,omitempty"`
	Domain    string `json:"domain,omitempty"`
	SourceIP  string `json:"source_ip,omitempty"`
	LogonType string `json:"logon_type,omitempty"`
	Outcome   string `json:"outcome,omitempty"`
	Message   string `json:"message,omitempty"`
}

type AuthEventsPayload struct {
	HostSerial string          `json:"host_serial"`
	HostName   string          `json:"host_name,omitempty"`
	HostIP     string          `json:"host_ip,omitempty"`
	Source     string          `json:"source,omitempty"`
	Events     []AuthEventItem `json:"events"`
}

type authCursor struct {
	LastRecordID int `json:"last_record_id"`
}

type authCollectionResult struct {
	MaxRecordID int             `json:"max_record_id"`
	Events      []AuthEventItem `json:"events"`
}

type windowsService struct{}

var agentLogger = log.New(os.Stdout, "", log.LstdFlags)
var backendProxy = ""

func (m *windowsService) Execute(_ []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (bool, uint32) {
	s <- svc.Status{State: svc.StartPending}
	s <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	cfg := loadConfig()
	setupLogger(cfg.LogPath)
	backendProxy = strings.TrimSpace(cfg.ProxyURL)
	agentLogger.Printf("service start: version=%s backend=%s", cfg.AgentVersion, cfg.BackendURL)
	runTicker := time.NewTicker(time.Duration(cfg.IntervalSeconds) * time.Second)
	defer runTicker.Stop()

	_ = runOnce(cfg)

	for {
		select {
		case <-runTicker.C:
			_ = runOnce(cfg)
		case c := <-r:
			switch c.Cmd {
			case svc.Stop, svc.Shutdown:
				s <- svc.Status{State: svc.StopPending}
				return false, 0
			default:
			}
		}
	}
}

func main() {
	cfg := loadConfig()
	setupLogger(cfg.LogPath)
	backendProxy = strings.TrimSpace(cfg.ProxyURL)
	agentLogger.Printf("agent start: version=%s backend=%s", cfg.AgentVersion, cfg.BackendURL)

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "-once":
			if err := runOnce(cfg); err != nil {
				fmt.Println("run error:", err)
				os.Exit(1)
			}
			return
		case "-service":
			if err := svc.Run("ITMonitoringGoAgent", &windowsService{}); err != nil {
				fmt.Println("service error:", err)
				os.Exit(1)
			}
			return
		}
	}

	if runtime.GOOS == "windows" {
		isService, _ := svc.IsWindowsService()
		if isService {
			if err := svc.Run("ITMonitoringGoAgent", &windowsService{}); err != nil {
				os.Exit(1)
			}
			return
		}
	}

	if err := runOnce(cfg); err != nil {
		agentLogger.Printf("run error: %v", err)
		os.Exit(1)
	}
}

func loadConfig() Config {
	cfg := Config{
		BackendURL:      envOrDefault("ASSET_BACKEND_URL", "http://192.168.196.134:8000/assets/scan"),
		IntervalSeconds: 300,
		AgentVersion:    "1.0.0",
		ProxyURL:        strings.TrimSpace(os.Getenv("ASSET_BACKEND_PROXY")),
		LogPath:         envOrDefault("ASSET_AGENT_LOG_PATH", "C:\\ProgramData\\ITMonitoringAgent\\agent.log"),
	}

	exe, err := os.Executable()
	if err != nil {
		return cfg
	}
	cfgPath := filepath.Join(filepath.Dir(exe), "config.json")
	b, err := os.ReadFile(cfgPath)
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(b, &cfg)

	if cfg.IntervalSeconds < 30 {
		cfg.IntervalSeconds = 30
	}
	if strings.TrimSpace(cfg.BackendURL) == "" {
		cfg.BackendURL = "http://192.168.196.134:8000/assets/scan"
	}
	if strings.TrimSpace(cfg.AgentVersion) == "" {
		cfg.AgentVersion = "1.0.0"
	}
	if strings.TrimSpace(cfg.LogPath) == "" {
		cfg.LogPath = "C:\\ProgramData\\ITMonitoringAgent\\agent.log"
	}
	return cfg
}

func setupLogger(logPath string) {
	if strings.TrimSpace(logPath) == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(logPath), 0o755)
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fallbackPath := filepath.Join(os.TempDir(), "it-monitoring-agent.log")
		ff, ferr := os.OpenFile(fallbackPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if ferr != nil {
			fmt.Println("logger setup failed:", err)
			return
		}
		agentLogger = log.New(io.MultiWriter(os.Stdout, ff), "", log.LstdFlags)
		agentLogger.Printf("primary log unavailable (%v), using fallback: %s", err, fallbackPath)
		return
	}
	agentLogger = log.New(io.MultiWriter(os.Stdout, f), "", log.LstdFlags)
}

func runOnce(cfg Config) error {
	agentLogger.Println("collection cycle started")
	hostname, _ := os.Hostname()
	ip := primaryIPv4()
	mac := primaryMAC()
	serial, model := serialAndModel()
	if serial == "" {
		serial = hostname
	}
	agentID := serial + "|" + hostname

	asset := AssetPayload{
		Hostname:     hostname,
		OS:           "Windows",
		OSVersion:    windowsVersion(),
		IP:           ip,
		SerialNumber: serial,
		Model:        model,
		Mac:          mac,
		Software:     installedSoftware(),
	}

	if err := postJSON(cfg.BackendURL, asset); err != nil {
		agentLogger.Printf("asset upload failed: %v", err)
		return err
	}

	security := SecurityPayload{
		Hostname:                  hostname,
		SerialNumber:              serial,
		IPAddress:                 ip,
		Source:                    "local_agent",
		AgentSource:               "go",
		AgentVersion:              cfg.AgentVersion,
		AgentID:                   agentID,
		OS:                        "Windows",
		FirewallEnabled:           psBool("@(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $true }).Count -gt 0"),
		DefenderEnabled:           psBool("(Get-MpComputerStatus).AntivirusEnabled"),
		RealtimeProtectionEnabled: psBool("(Get-MpComputerStatus).RealTimeProtectionEnabled"),
		BitlockerEnabled:          psBool("(Get-BitLockerVolume -MountPoint 'C:').ProtectionStatus -eq 'On' -or (Get-BitLockerVolume -MountPoint 'C:').ProtectionStatus -eq 1"),
		PendingReboot:             pendingReboot(),
	}

	metrics := ResourcePayload{
		SerialNumber: serial,
		Hostname:     hostname,
		Source:       "local_agent",
		AgentSource:  "go",
		AgentVersion: cfg.AgentVersion,
		AgentID:      agentID,
		CPUPercent:   ptrFloat(psFloat("(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average")),
		RAMTotalGB:   ptrFloat(psFloat("$o=Get-CimInstance Win32_OperatingSystem; [math]::Round($o.TotalVisibleMemorySize/1MB,2)")),
		RAMUsedGB:    ptrFloat(psFloat("$o=Get-CimInstance Win32_OperatingSystem; [math]::Round(($o.TotalVisibleMemorySize-$o.FreePhysicalMemory)/1MB,2)")),
		DiskTotalGB:  ptrFloat(psFloat("$d=Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\"; [math]::Round((($d|Measure-Object Size -Sum).Sum)/1GB,2)")),
		DiskUsedGB:   ptrFloat(psFloat("$d=Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\"; $t=($d|Measure-Object Size -Sum).Sum; $f=($d|Measure-Object FreeSpace -Sum).Sum; [math]::Round(($t-$f)/1GB,2)")),
	}

	securityURL := strings.Replace(cfg.BackendURL, "/assets/scan", "/security/posture", 1)
	metricsURL := strings.Replace(cfg.BackendURL, "/assets/scan", "/metrics/resources", 1)
	networkURL := strings.Replace(cfg.BackendURL, "/assets/scan", "/network/telemetry", 1)

	if err := postJSON(securityURL, security); err != nil {
		agentLogger.Printf("security upload failed: %v", err)
	}
	if err := postJSON(metricsURL, metrics); err != nil {
		agentLogger.Printf("metrics upload failed: %v", err)
	}

	hosts := []NetworkHost{localTelemetryHost(serial, hostname, ip, cfg.AgentVersion, agentID)}
	hosts = append(hosts, probeLAN(ip, cfg.AgentVersion, agentID)...)
	if err := postJSON(networkURL, NetworkPayload{Hosts: hosts}); err != nil {
		agentLogger.Printf("network upload failed: %v", err)
	}

	authURL := strings.Replace(cfg.BackendURL, "/assets/scan", "/siem/auth-events", 1)
	authEvents, err := collectAuthEvents(cfg, 400)
	if err != nil {
		agentLogger.Printf("auth collection failed: %v", err)
	} else if len(authEvents) > 0 {
		authPayload := AuthEventsPayload{
			HostSerial: serial,
			HostName:   hostname,
			HostIP:     ip,
			Source:     "local_agent_go",
			Events:     authEvents,
		}
		if err := postJSON(authURL, authPayload); err != nil {
			agentLogger.Printf("auth upload failed: %v", err)
		}
	}

	agentLogger.Printf("collection cycle completed: software=%d hosts=%d", len(asset.Software), len(hosts))
	return nil
}

func localTelemetryHost(serial, hostname, ip, version, agentID string) NetworkHost {
	return NetworkHost{
		SerialNumber: serial,
		Hostname:     hostname,
		IPAddress:    ip,
		Source:       "local_agent",
		AgentSource:  "go",
		AgentVersion: version,
		AgentID:      agentID,
		OpenPorts:    openPorts(hostname),
		Logs:         recentSystemLogs(),
	}
}

func probeLAN(localIP, version, agentID string) []NetworkHost {
	parts := strings.Split(localIP, ".")
	if len(parts) != 4 {
		return nil
	}
	subnet := strings.Join(parts[:3], ".")
	results := make([]NetworkHost, 0, 30)

	for i := 1; i <= 40; i++ {
		target := fmt.Sprintf("%s.%d", subnet, i)
		if target == localIP {
			continue
		}
		if !isHostReachable(target) {
			continue
		}
		hostname := reverseDNS(target)
		if hostname == "" {
			hostname = "Unknown-" + target
		}
		results = append(results, NetworkHost{
			SerialNumber: "NET-" + target,
			Hostname:     hostname,
			IPAddress:    target,
			Source:       "lan_probe",
			AgentSource:  "go",
			AgentVersion: version,
			AgentID:      agentID,
			OpenPorts:    openPorts(target),
			Logs: []string{
				"Probe LAN " + time.Now().Format(time.RFC3339) + ": host detected",
				"IP: " + target,
			},
		})
	}

	return results
}

func isHostReachable(ip string) bool {
	for _, port := range []int{445, 3389, 135} {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), 250*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return true
		}
	}
	return false
}

func reverseDNS(ip string) string {
	names, err := net.LookupAddr(ip)
	if err != nil || len(names) == 0 {
		return ""
	}
	return strings.TrimSuffix(names[0], ".")
}

func openPorts(host string) []int {
	common := []int{22, 53, 80, 135, 139, 389, 443, 445, 636, 3389, 5985, 5986}
	ports := make([]int, 0, len(common))
	for _, p := range common {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, p), 300*time.Millisecond)
		if err == nil {
			ports = append(ports, p)
			_ = conn.Close()
		}
	}
	sort.Ints(ports)
	return ports
}

func recentSystemLogs() []string {
	out, err := runPS("Get-WinEvent -LogName System -MaxEvents 8 | ForEach-Object { $m=$_.Message -replace \"`r`n\",\" \"; if($m.Length -gt 180){$m=$m.Substring(0,180)+\"...\"}; \"$($_.TimeCreated.ToString('s')) | ID:$($_.Id) | $m\" }")
	if err != nil || strings.TrimSpace(out) == "" {
		return []string{}
	}
	lines := strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n")
	logs := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			logs = append(logs, line)
		}
	}
	return logs
}

func authCursorPath(cfg Config) string {
	override := strings.TrimSpace(os.Getenv("ASSET_AUTH_CURSOR_PATH"))
	if override != "" {
		return override
	}
	baseDir := filepath.Dir(cfg.LogPath)
	if strings.TrimSpace(baseDir) == "" || baseDir == "." {
		baseDir = `C:\ProgramData\ITMonitoringAgent`
	}
	return filepath.Join(baseDir, "auth_cursor_go.json")
}

func loadAuthCursor(path string) int {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	var cur authCursor
	if err := json.Unmarshal(b, &cur); err != nil {
		return 0
	}
	if cur.LastRecordID < 0 {
		return 0
	}
	return cur.LastRecordID
}

func saveAuthCursor(path string, recordID int) {
	if recordID <= 0 {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	b, err := json.Marshal(authCursor{LastRecordID: recordID})
	if err != nil {
		return
	}
	_ = os.WriteFile(path, b, 0o644)
}

func collectAuthEvents(cfg Config, maxEvents int) ([]AuthEventItem, error) {
	cursorFile := authCursorPath(cfg)
	lastRecordID := loadAuthCursor(cursorFile)
	if maxEvents <= 0 {
		maxEvents = 400
	}

	ps := fmt.Sprintf(`
$last = %d
$max = %d
$ids = @(4624, 4625, 4740)
$events = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = $ids } -MaxEvents $max -ErrorAction SilentlyContinue | Sort-Object RecordId
$result = @()
$maxSeen = $last
foreach ($evt in $events) {
  if ($evt.RecordId -le $last) { continue }
  $xml = [xml]$evt.ToXml()
  $map = @{}
  foreach ($d in $xml.Event.EventData.Data) {
    if ($null -ne $d.Name -and $d.Name -ne '') {
      $map[$d.Name] = [string]$d.'#text'
    }
  }
  $eventId = [int]$evt.Id
  $outcome = if ($eventId -eq 4624) { 'success' } elseif ($eventId -eq 4625 -or $eventId -eq 4740) { 'failure' } else { 'unknown' }
  $targetUser = [string]$map['TargetUserName']
  if ([string]::IsNullOrWhiteSpace($targetUser)) { $targetUser = [string]$map['SubjectUserName'] }
  $targetDomain = [string]$map['TargetDomainName']
  if ([string]::IsNullOrWhiteSpace($targetDomain)) { $targetDomain = [string]$map['SubjectDomainName'] }
  $sourceIp = [string]$map['IpAddress']
  if ([string]::IsNullOrWhiteSpace($sourceIp) -or $sourceIp -eq '-') { $sourceIp = [string]$map['WorkstationName'] }
  $logonType = [string]$map['LogonType']
  $message = [string]$evt.Message
  if ($message.Length -gt 1000) { $message = $message.Substring(0, 1000) }

  $result += [PSCustomObject]@{
    record_id  = [int]$evt.RecordId
    event_id   = $eventId
    timestamp  = $evt.TimeCreated.ToString('o')
    user_name  = $targetUser
    domain     = $targetDomain
    source_ip  = $sourceIp
    logon_type = $logonType
    outcome    = $outcome
    message    = $message
  }

  if ($evt.RecordId -gt $maxSeen) { $maxSeen = [int]$evt.RecordId }
}
[PSCustomObject]@{
  max_record_id = $maxSeen
  events        = $result
} | ConvertTo-Json -Depth 6 -Compress
`, lastRecordID, maxEvents)

	out, err := runPS(ps)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(out) == "" {
		return nil, nil
	}

	var collected authCollectionResult
	if err := json.Unmarshal([]byte(out), &collected); err != nil {
		return nil, err
	}
	if collected.MaxRecordID > lastRecordID {
		saveAuthCursor(cursorFile, collected.MaxRecordID)
	}
	return collected.Events, nil
}

func installedSoftware() []SoftwareItem {
	ps := `
$paths = @(
 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$items = foreach($p in $paths){
 if(Test-Path $p){
  Get-ItemProperty -Path $p -ErrorAction SilentlyContinue |
   Where-Object { $_.DisplayName } |
   ForEach-Object {
    [PSCustomObject]@{
      name = [string]$_.DisplayName
      version = [string]$_.DisplayVersion
      publisher = [string]$_.Publisher
      install_date = [string]$_.InstallDate
      license_key = ''
    }
   }
 }
}
$items | Group-Object { "$($_.name)|$($_.version)" } | ForEach-Object { $_.Group[0] } | Sort-Object name | ConvertTo-Json -Depth 4
`
	out, err := runPS(ps)
	if err != nil || strings.TrimSpace(out) == "" {
		return []SoftwareItem{}
	}

	var one SoftwareItem
	if err := json.Unmarshal([]byte(out), &one); err == nil && one.Name != "" {
		return []SoftwareItem{one}
	}
	var many []SoftwareItem
	if err := json.Unmarshal([]byte(out), &many); err == nil {
		return many
	}
	return []SoftwareItem{}
}

func serialAndModel() (string, string) {
	serial := strings.TrimSpace(wmicValue("bios", "serialnumber"))
	model := strings.TrimSpace(wmicValue("computersystem", "model"))
	return serial, model
}

func windowsVersion() string {
	out, err := runPS("[System.Environment]::OSVersion.VersionString")
	if err != nil {
		return runtime.GOOS
	}
	return strings.TrimSpace(out)
}

func primaryIPv4() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP == nil || ipNet.IP.IsLoopback() {
				continue
			}
			ip := ipNet.IP.To4()
			if ip != nil {
				return ip.String()
			}
		}
	}
	return ""
}

func primaryMAC() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if len(iface.HardwareAddr) > 0 {
			return strings.ToLower(iface.HardwareAddr.String())
		}
	}
	return ""
}

func pendingReboot() bool {
	cmd := `if(Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'){"true"}elseif(Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'){"true"}else{"false"}`
	return psBool(cmd)
}

func wmicValue(alias, field string) string {
	out, err := exec.Command("wmic", alias, "get", field).CombinedOutput()
	if err != nil {
		return ""
	}
	lines := strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n")
	if len(lines) < 2 {
		return ""
	}
	for _, line := range lines[1:] {
		v := strings.TrimSpace(line)
		if v != "" {
			return v
		}
	}
	return ""
}

func runPS(script string) (string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func psBool(script string) bool {
	out, err := runPS("if(" + script + "){\"true\"}else{\"false\"}")
	if err != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(out), "true")
}

func psFloat(script string) float64 {
	out, err := runPS(script)
	if err != nil {
		return 0
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return 0
	}
	f, err := strconv.ParseFloat(out, 64)
	if err != nil {
		re := regexp.MustCompile(`[-+]?[0-9]*\.?[0-9]+`)
		m := re.FindString(out)
		if m == "" {
			return 0
		}
		f, err = strconv.ParseFloat(m, 64)
		if err != nil {
			return 0
		}
	}
	return f
}

func ptrFloat(v float64) *float64 {
	return &v
}

func postJSON(url string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	transport := http.DefaultTransport.(*http.Transport).Clone()
	proxyRaw := backendProxy
	if proxyRaw == "" {
		proxyRaw = strings.TrimSpace(os.Getenv("ASSET_BACKEND_PROXY"))
	}
	if proxyRaw != "" {
		proxyURL, err := urlpkgParse(proxyRaw)
		if err == nil {
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}
	client := &http.Client{Timeout: 30 * time.Second, Transport: transport}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		if len(raw) == 0 {
			return errors.New("http status " + resp.Status)
		}
		return fmt.Errorf("http %s: %s", resp.Status, strings.TrimSpace(string(raw)))
	}
	return nil
}

func urlpkgParse(raw string) (*url.URL, error) {
	return url.Parse(raw)
}

func envOrDefault(name, fallback string) string {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	return v
}
