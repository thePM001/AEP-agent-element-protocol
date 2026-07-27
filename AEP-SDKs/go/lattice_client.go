package aepsdk

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// GatewayMeta optional lattice gateway audit fields.
type GatewayMeta struct {
	AgentID      string
	ChannelID    string
	ContractID   string
	EventType    string
	SessionID    string
	TrustScore   int
	Gateway      string
	PayloadExtra map[string]any
}

func latticeStrictEnabled() (bool, error) {
	if os.Getenv("AEP_LATTICE_STRICT") == "0" {
		if os.Getenv("AEP_LATTICE_STRICT_DEV") == "1" {
			return false, nil
		}
		return false, fmt.Errorf("AEP_LATTICE_STRICT=0 refused outside AEP_LATTICE_STRICT_DEV=1 (fail-closed)")
	}
	return true, nil
}

func assertURLNotSSRF(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("lattice-gated-fetch: invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("lattice-gated-fetch: blocked protocol %s", u.Scheme)
	}
	host := strings.ToLower(u.Hostname())
	host = strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
	allowLoop := os.Getenv("AEP_LATTICE_ALLOW_LOOPBACK") == "1"
	allowPriv := os.Getenv("AEP_LATTICE_ALLOW_PRIVATE") == "1"
	isLoopback := host == "localhost" || host == "0.0.0.0" || host == "::1" ||
		strings.HasPrefix(host, "127.") || strings.HasPrefix(host, "::ffff:127.")
	if !allowLoop && isLoopback {
		return fmt.Errorf("lattice-gated-fetch: loopback blocked")
	}
	isPrivate := strings.HasPrefix(host, "10.") ||
		strings.HasPrefix(host, "192.168.") ||
		strings.HasPrefix(host, "169.254.") ||
		strings.HasSuffix(host, ".internal") ||
		host == "metadata.google.internal" ||
		host == "metadata" ||
		strings.HasSuffix(host, ".local")
	if !isPrivate {
		// 172.16/12
		if strings.HasPrefix(host, "172.") {
			var a, b int
			if _, err := fmt.Sscanf(host, "172.%d.%d", &a, &b); err == nil && a >= 16 && a <= 31 {
				isPrivate = true
			}
		}
	}
	if !allowPriv && isPrivate {
		return fmt.Errorf("lattice-gated-fetch: private/metadata host blocked")
	}
	return nil
}

func resolveSocketBase() string {
	if base := os.Getenv("AEP_SOCKET_BASE"); base != "" {
		return base
	}
	data := os.Getenv("AEP_DATA")
	if data == "" {
		home, _ := os.UserHomeDir()
		data = filepath.Join(home, ".aep")
	}
	return filepath.Join(data, "sockets")
}

func resolveLatticeLogBin() string {
	if bin := os.Getenv("AEP_LATTICE_LOG_BIN"); bin != "" {
		return bin
	}
	if bin := os.Getenv("AEP_LATTICE_LOG_CLI"); bin != "" {
		return bin
	}
	return "aep-lattice-log"
}

func resolveConfigPath() string {
	data := os.Getenv("AEP_DATA")
	if data == "" {
		home, _ := os.UserHomeDir()
		data = filepath.Join(home, ".aep")
	}
	path := filepath.Join(data, "base-node.json")
	if _, err := os.Stat(path); err == nil {
		return path
	}
	return ""
}

// BuildLatticeFrame shells out to aep-lattice-log (lattice-gated only; no npm).
func BuildLatticeFrame(event map[string]any) (map[string]any, error) {
	in, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	args := []string{}
	if cfg := resolveConfigPath(); cfg != "" {
		args = append(args, "--config", cfg)
	}
	args = append(args, "build-frame")
	cmd := exec.Command(resolveLatticeLogBin(), args...)
	cmd.Stdin = bytes.NewReader(in)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, err
	}
	if parsed["frame"] == nil {
		return nil, fmt.Errorf("aep-lattice-log build-frame missing LatticeChannelFrame")
	}
	return parsed, nil
}

func dockSuffix(dockPort string) string {
	switch dockPort {
	case "inference_engine":
		return "inference"
	case "validation_engine":
		return "validation"
	case "future_features":
		return "future"
	case "regulation_module":
		return "regulation"
	default:
		return dockPort
	}
}

func sendLatticeLine(socketPath, line string, timeout time.Duration) (string, error) {
	conn, err := net.DialTimeout("unix", socketPath, timeout)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write([]byte(line + "\n")); err != nil {
		return "", err
	}
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := conn.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			if bytes.Contains(buf, []byte("\n")) {
				break
			}
		}
		if err != nil {
			if err == io.EOF && len(buf) > 0 {
				break
			}
			return "", err
		}
	}
	return strings.TrimSpace(string(bytes.SplitN(buf, []byte("\n"), 2)[0])), nil
}

func latticeDockRequest(socketBase, dockPort string, event map[string]any) error {
	socketPath := filepath.Join(socketBase, dockSuffix(dockPort))
	sealed, err := BuildLatticeFrame(event)
	if err != nil {
		return err
	}
	wire, err := json.Marshal(map[string]any{"frame": sealed["frame"]})
	if err != nil {
		return err
	}
	line, err := sendLatticeLine(socketPath, string(wire), 8*time.Second)
	if err != nil {
		return err
	}
	var resp map[string]any
	if err := json.Unmarshal([]byte(line), &resp); err != nil {
		return err
	}
	if ok, _ := resp["ok"].(bool); !ok {
		if msg, _ := resp["error"].(string); msg != "" {
			return fmt.Errorf("%s", msg)
		}
		return fmt.Errorf("lattice frame rejected")
	}
	return nil
}

// LatticeGatedFetch performs HTTP after inference_engine lattice audit.
func LatticeGatedFetch(rawURL, method string, body io.Reader, meta GatewayMeta, socketBase string) (*http.Response, error) {
	if err := assertURLNotSSRF(rawURL); err != nil {
		return nil, err
	}
	strict, err := latticeStrictEnabled()
	if err != nil {
		return nil, err
	}
	if !strict {
		req, err := http.NewRequest(method, rawURL, body)
		if err != nil {
			return nil, err
		}
		return http.DefaultClient.Do(req)
	}
	if socketBase == "" {
		socketBase = resolveSocketBase()
	}
	if meta.AgentID == "" {
		meta.AgentID = "lattice-gateway"
	}
	if meta.ChannelID == "" {
		meta.ChannelID = "ch-outbound-gateway"
	}
	if meta.ContractID == "" {
		meta.ContractID = "lattice-channel-default"
	}
	if meta.EventType == "" {
		meta.EventType = "LATTICE_GATEWAY_REQUEST"
	}
	if meta.SessionID == "" {
		meta.SessionID = "gateway-session"
	}
	if meta.TrustScore == 0 {
		meta.TrustScore = 750
	}
	if meta.Gateway == "" {
		meta.Gateway = "http"
	}
	event := map[string]any{
		"agent_id":      meta.AgentID,
		"channel_id":    meta.ChannelID,
		"contract_id":   meta.ContractID,
		"event_type":    meta.EventType,
		"session_id":    meta.SessionID,
		"docking_port":  "inference_engine",
		"trust_score":   meta.TrustScore,
		"payload": map[string]any{
			"url":     rawURL,
			"method":  method,
			"gateway": meta.Gateway,
		},
	}
	for k, v := range meta.PayloadExtra {
		event["payload"].(map[string]any)[k] = v
	}
	if err := latticeDockRequest(socketBase, "inference_engine", event); err != nil {
		return nil, err
	}
	inferencePath := filepath.Join(socketBase, "inference")
	if _, err := os.Stat(inferencePath); err != nil {
		return nil, fmt.Errorf("inference_engine dock required: %s", inferencePath)
	}
	req, err := http.NewRequest(method, rawURL, body)
	if err != nil {
		return nil, err
	}
	return http.DefaultClient.Do(req)
}