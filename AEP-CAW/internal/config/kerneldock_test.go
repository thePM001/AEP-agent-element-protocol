package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nla-aep/aep-caw-framework/internal/kerneldock"
)

func writeKernelDockConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestLoadEnablesKernelDockCheckByDefault(t *testing.T) {
	path := writeKernelDockConfig(t, "server:\n  http:\n    addr: \"127.0.0.1:18080\"\n")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.KernelDock.KernelDockEnabled() {
		t.Fatal("applyDefaults must turn the check on for a loaded config, because the refusal is the safe default")
	}
	if cfg.KernelDock.Dock != kerneldock.DefaultDock {
		t.Fatalf("default dock = %q, want %q", cfg.KernelDock.Dock, kerneldock.DefaultDock)
	}
	if got := cfg.KernelDock.KernelDockTimeout(); got != kerneldock.DefaultTimeout {
		t.Fatalf("default timeout = %v, want %v", got, kerneldock.DefaultTimeout)
	}
	if cfg.KernelDock.SocketBase != "" {
		t.Fatalf("default socket base = %q, want empty so the probe resolves AEP_SOCKET_BASE or AEP_DATA/sockets", cfg.KernelDock.SocketBase)
	}
}

func TestLoadHonoursExplicitKernelDockSettings(t *testing.T) {
	body := "kernel_dock:\n  enabled: false\n  socket_base: /run/aep/sockets\n  dock: inference_engine\n  timeout: 1500ms\n"
	cfg, err := Load(writeKernelDockConfig(t, body))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.KernelDock.KernelDockEnabled() {
		t.Fatal("kernel_dock.enabled false must turn the check off")
	}
	if cfg.KernelDock.SocketBase != "/run/aep/sockets" {
		t.Fatalf("socket base = %q", cfg.KernelDock.SocketBase)
	}
	if cfg.KernelDock.Dock != "inference_engine" {
		t.Fatalf("dock = %q", cfg.KernelDock.Dock)
	}
	if got := cfg.KernelDock.KernelDockTimeout(); got != 1500*time.Millisecond {
		t.Fatalf("timeout = %v, want 1.5s", got)
	}
}

func TestLoadRefusesUnknownKernelDock(t *testing.T) {
	_, err := Load(writeKernelDockConfig(t, "kernel_dock:\n  dock: board\n"))
	if err == nil {
		t.Fatal("Load with an unknown dock = nil error, want a complaint")
	}
	if !strings.Contains(err.Error(), "unknown kernel dock") {
		t.Fatalf("error = %v, want an unknown dock complaint", err)
	}
}

func TestLoadRefusesBadKernelDockTimeout(t *testing.T) {
	_, err := Load(writeKernelDockConfig(t, "kernel_dock:\n  timeout: soon\n"))
	if err == nil {
		t.Fatal("Load with a bad timeout = nil error, want a complaint")
	}
	if !strings.Contains(err.Error(), "kernel_dock.timeout") {
		t.Fatalf("error = %v, want a kernel_dock.timeout complaint", err)
	}
}

func TestKernelDockTimeoutFallsBackOnUnparsableValue(t *testing.T) {
	c := KernelDockConfig{Timeout: "not a duration"}
	if got := c.KernelDockTimeout(); got != kerneldock.DefaultTimeout {
		t.Fatalf("KernelDockTimeout = %v, want the default", got)
	}
}
