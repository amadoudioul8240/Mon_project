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

func (m *windowsService) Execute(_ []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (bool, uint32) {
	s <- svc.Status{State: svc.StartPending}
	s <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	cfg := loadConfig()
	setupLogger(cfg.LogPath)
	agentLogger.Printf("auth-only service start: version=%s backend=%s", cfg.AgentVersion, authURL(cfg.BackendURL))
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
	agentLogger.Printf("auth-only agent start: version=%s backend=%s", cfg.AgentVersion, authURL(cfg.BackendURL))

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "-once":
			if err := runOnce(cfg); err != nil {
				fmt.Println("run error:", err)
				os.Exit(1)
			}
			return
		case "-service":
			if err := svc.Run("ITMonitoringGoAuthAgent", &windowsService{}); err != nil {
				fmt.Println("service error:", err)
				os.Exit(1)
			}
			return
		}
	}

	if isService, _ := svc.IsWindowsService(); isService {
		if err := svc.Run("ITMonitoringGoAuthAgent", &windowsService{}); err != nil {
			os.Exit(1)
		}
		return
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
		LogPath:         envOrDefault("ASSET_AGENT_LOG_PATH", "C:\\ProgramData\\ITMonitoringAuthGoAgent\\agent.log"),
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
		cfg.LogPath = "C:\\ProgramData\\ITMonitoringAuthGoAgent\\agent.log"
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
		fallbackPath := filepath.Join(os.TempDir(), "it-monitoring-go-auth-agent.log")
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
	agentLogger.Println("auth-only collection cycle started")
	hostname, _ := os.Hostname()
	ip := primaryIPv4()
	serial := serialNumber()
	if serial == "" {
		serial = hostname
	}

	authEvents, err := collectAuthEvents(cfg, 400)
	if err != nil {
		agentLogger.Printf("auth collection failed: %v", err)
		return err
	}
	if len(authEvents) == 0 {
		agentLogger.Println("auth-only collection cycle completed: events=0")
		return nil
	}

	payload := AuthEventsPayload{
		HostSerial: serial,
		HostName:   hostname,
		HostIP:     ip,
		Source:     "go_auth_agent",
		Events:     authEvents,
	}
	if err := postJSON(authURL(cfg.BackendURL), cfg.ProxyURL, payload); err != nil {
		agentLogger.Printf("auth upload failed: %v", err)
		return err
	}

	agentLogger.Printf("auth-only collection cycle completed: events=%d", len(authEvents))
	return nil
}

func authURL(backendURL string) string {
	return strings.Replace(backendURL, "/assets/scan", "/siem/auth-events", 1)
}

func authCursorPath(cfg Config) string {
	override := strings.TrimSpace(os.Getenv("ASSET_AUTH_CURSOR_PATH"))
	if override != "" {
		return override
	}
	baseDir := filepath.Dir(cfg.LogPath)
	if strings.TrimSpace(baseDir) == "" || baseDir == "." {
		baseDir = `C:\ProgramData\ITMonitoringAuthGoAgent`
	}
	return filepath.Join(baseDir, "auth_cursor_go_auth_only.json")
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
	$outcome = if ($eventId -eq 4624) { 'success' } elseif ($eventId -eq 4625) { 'failure' } elseif ($eventId -eq 4740) { 'lockout' } else { 'unknown' }
	$targetUser = [string]$map['TargetUserName']
	if ([string]::IsNullOrWhiteSpace($targetUser)) { $targetUser = [string]$map['SubjectUserName'] }
	$targetDomain = [string]$map['TargetDomainName']
	if ([string]::IsNullOrWhiteSpace($targetDomain)) { $targetDomain = [string]$map['SubjectDomainName'] }
	$sourceIp = [string]$map['IpAddress']
	if ([string]::IsNullOrWhiteSpace($sourceIp) -or $sourceIp -eq '-') { $sourceIp = [string]$map['WorkstationName'] }
	$logonType = [string]$map['LogonType']
	$message = [string]$evt.Message
	$message = $message.Replace([Environment]::NewLine, ' ')
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

func serialNumber() string {
	out, err := exec.Command("wmic", "bios", "get", "serialnumber").CombinedOutput()
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

func runPS(script string) (string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func postJSON(targetURL, proxyRaw string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, targetURL, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	transport := http.DefaultTransport.(*http.Transport).Clone()
	proxyRaw = strings.TrimSpace(proxyRaw)
	if proxyRaw == "" {
		proxyRaw = strings.TrimSpace(os.Getenv("ASSET_BACKEND_PROXY"))
	}
	if proxyRaw != "" {
		proxyURL, err := url.Parse(proxyRaw)
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

func envOrDefault(name, fallback string) string {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	return v
}
