package server

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/capabilities"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
)

const guardedDefaultPolicy = `version: 1
name: default
file_rules:
  - name: deny-secrets
    paths: ["/secrets/**"]
    operations: ["*"]
    decision: deny
network_rules:
  - name: deny-metadata
    cidrs: ["169.254.169.254/32"]
    decision: deny
command_rules:
  - name: allow-all
    commands: ["*"]
    decision: allow
`

func startupTestConfig(t *testing.T, policyYAML string) *config.Config {
	t.Helper()
	dir := t.TempDir()
	policyDir := filepath.Join(dir, "policies")
	if err := os.MkdirAll(policyDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(policyDir, "default.yaml"), []byte(policyYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Development.DisableAuth = true
	cfg.Server.HTTP.Addr = "127.0.0.1:0"
	cfg.Server.HTTP.ReadTimeout = "1s"
	cfg.Server.HTTP.WriteTimeout = "1s"
	cfg.Server.HTTP.MaxRequestSize = "1MB"
	cfg.Sessions.BaseDir = filepath.Join(dir, "sessions")
	cfg.Audit.Storage.SQLitePath = filepath.Join(dir, "events.db")
	cfg.Policies.Dir = policyDir
	cfg.Policies.Default = "default"
	cfg.Metrics.Enabled = false
	cfg.Health.Path = "/health"
	cfg.Health.ReadinessPath = "/ready"
	return cfg
}

// AEP-CRV-040: the server refuses to start when the loaded policy holds file
// or network rules that no active backend enforces.
func TestNew_RefusesPolicyWithUnenforcedRules(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the enforcement check judges the Linux backends")
	}
	cfg := startupTestConfig(t, guardedDefaultPolicy)
	s, err := New(cfg)
	if err == nil {
		_ = s.Close()
		t.Fatal("the server started with rules no backend enforces")
	}
	for _, want := range []string{"unenforced-policy-rules", "file_rules", "network_rules", "allow_degraded"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("err = %v, want it to name %q", err, want)
		}
	}
}

func TestNew_AllowDegradedRunsUnenforcedRules(t *testing.T) {
	cfg := startupTestConfig(t, guardedDefaultPolicy)
	cfg.Sandbox.AllowDegraded = true
	s, err := New(cfg)
	if err != nil {
		t.Fatalf("allow_degraded must let the server start: %v", err)
	}
	_ = s.Close()
}

func withSecurityCaps(t *testing.T, caps *capabilities.SecurityCapabilities) {
	t.Helper()
	prev := detectSecurityCapabilities
	t.Cleanup(func() { detectSecurityCapabilities = prev })
	detectSecurityCapabilities = func() *capabilities.SecurityCapabilities { return caps }
}

// CAWA-12 acceptance: security.strict with mode full on a host without eBPF
// stops the server at startup.
func TestNew_StrictModeRefusesMissingCapability(t *testing.T) {
	withSecurityCaps(t, &capabilities.SecurityCapabilities{SeccompInstallable: true, Seccomp: true, FUSE: true})
	cfg := startupTestConfig(t, guardedDefaultPolicy)
	cfg.Sandbox.AllowDegraded = true
	cfg.Security.Mode = "full"
	cfg.Security.Strict = true
	s, err := New(cfg)
	if err == nil {
		_ = s.Close()
		t.Fatal("strict mode started without eBPF")
	}
	if !strings.Contains(err.Error(), "strict mode validation failed") || !strings.Contains(err.Error(), "eBPF") {
		t.Fatalf("err = %v, want the strict eBPF refusal", err)
	}
}

func TestNew_MinimumModeRefusesWeakerHost(t *testing.T) {
	withSecurityCaps(t, &capabilities.SecurityCapabilities{})
	cfg := startupTestConfig(t, guardedDefaultPolicy)
	cfg.Sandbox.AllowDegraded = true
	cfg.Security.Mode = "auto"
	cfg.Security.MinimumMode = "landlock"
	s, err := New(cfg)
	if err == nil {
		_ = s.Close()
		t.Fatal("minimum_mode landlock started on a minimal host")
	}
	if !strings.Contains(err.Error(), "minimum mode validation failed") {
		t.Fatalf("err = %v, want the minimum mode refusal", err)
	}
}

// Strict mode refuses a layer the config switches on but the kernel lacks.
func TestDetectAndValidateSecurityMode_StrictLayers(t *testing.T) {
	full := &capabilities.SecurityCapabilities{SeccompInstallable: true, Seccomp: true, EBPF: true, FUSE: true}
	withSecurityCaps(t, full)

	cfg := &config.Config{Security: config.SecurityConfig{Mode: "full", Strict: true}}
	if _, _, err := DetectAndValidateSecurityMode(cfg); err != nil {
		t.Fatalf("full host: %v", err)
	}
	cfg.Landlock.Enabled = true
	if _, _, err := DetectAndValidateSecurityMode(cfg); err == nil || !strings.Contains(err.Error(), "Landlock") {
		t.Fatalf("landlock.enabled without Landlock: err = %v", err)
	}
	cfg.Landlock.Enabled = false
	noFUSE := *full
	noFUSE.FUSE = false
	withSecurityCaps(t, &noFUSE)
	cfg.Security.Mode = "landlock-only"
	cfg.Sandbox.FUSE.Enabled = true
	noFUSE.Landlock = true
	if _, _, err := DetectAndValidateSecurityMode(cfg); err == nil || !strings.Contains(err.Error(), "FUSE") {
		t.Fatalf("sandbox.fuse.enabled without FUSE: err = %v", err)
	}
}

func TestSecurityModeRequested(t *testing.T) {
	if securityModeRequested(&config.Config{}) {
		t.Fatal("an empty config requests no mode")
	}
	if !securityModeRequested(&config.Config{Security: config.SecurityConfig{Strict: true}}) {
		t.Fatal("strict requests a mode")
	}
	if !securityModeRequested(&config.Config{Security: config.SecurityConfig{MinimumMode: "landlock"}}) {
		t.Fatal("minimum_mode requests a mode")
	}
}
