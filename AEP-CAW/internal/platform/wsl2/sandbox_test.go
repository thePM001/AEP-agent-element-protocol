//go:build windows

package wsl2

import (
	"context"
	"testing"

	"github.com/nla-aep/aep-caw-framework/internal/platform"
)

func TestNewSandboxManager(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	m := NewSandboxManager(p)

	if m == nil {
		t.Fatal("NewSandboxManager() returned nil")
	}

	if m.platform != p {
		t.Error("platform not set correctly")
	}

	if m.sandboxes == nil {
		t.Error("sandboxes map should be initialized")
	}
}

func TestSandboxManager_Available(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	m := &SandboxManager{
		platform:  p,
		available: true,
		sandboxes: make(map[string]*Sandbox),
	}

	if !m.Available() {
		t.Error("Available() should return true when available is true")
	}

	m.available = false
	if m.Available() {
		t.Error("Available() should return false when available is false")
	}
}

func TestSandboxManager_IsolationLevel(t *testing.T) {
	tests := []struct {
		name     string
		level    platform.IsolationLevel
		expected platform.IsolationLevel
	}{
		{"none", platform.IsolationNone, platform.IsolationNone},
		{"partial", platform.IsolationPartial, platform.IsolationPartial},
		{"full", platform.IsolationFull, platform.IsolationFull},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &Platform{distro: "Ubuntu"}
			m := &SandboxManager{
				platform:       p,
				available:      true,
				isolationLevel: tt.level,
				sandboxes:      make(map[string]*Sandbox),
			}

			if got := m.IsolationLevel(); got != tt.expected {
				t.Errorf("IsolationLevel() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestSandboxManager_Create_NotAvailable(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	m := &SandboxManager{
		platform:  p,
		available: false,
		sandboxes: make(map[string]*Sandbox),
	}

	_, err := m.Create(platform.SandboxConfig{Name: "test"})
	if err == nil {
		t.Error("Create() should error when not available")
	}
}

func TestSandboxManager_Create_Success(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	m := &SandboxManager{
		platform:       p,
		available:      true,
		isolationLevel: platform.IsolationFull,
		sandboxes:      make(map[string]*Sandbox),
	}

	cfg := platform.SandboxConfig{
		Name:          "test-sandbox",
		WorkspacePath: `C:\Users\test\workspace`,
	}

	sandbox, err := m.Create(cfg)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if sandbox == nil {
		t.Fatal("Create() returned nil sandbox")
	}

	if sandbox.ID() != "test-sandbox" {
		t.Errorf("ID() = %q, want test-sandbox", sandbox.ID())
	}

	// Check internal state
	s := sandbox.(*Sandbox)
	expectedWSLPath := "/mnt/c/Users/test/workspace"
	if s.wslWorkspace != expectedWSLPath {
		t.Errorf("wslWorkspace = %q, want %q", s.wslWorkspace, expectedWSLPath)
	}

	if s.isolationLevel != platform.IsolationFull {
		t.Errorf("isolationLevel = %v, want IsolationFull", s.isolationLevel)
	}
}

func TestSandboxManager_Create_DefaultName(t *testing.T) {
	p := &Platform{distro: "Ubuntu"}
	m := &SandboxManager{
		platform:  p,
		available: true,
		sandboxes: make(map[string]*Sandbox),
	}

	sandbox, err := m.Create(platform.SandboxConfig{})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if sandbox.ID() != "sandbox-wsl2" {
		t.Errorf("ID() = %q, want sandbox-wsl2", sandbox.ID())
	}
}

func TestSandbox_ID(t *testing.T) {
	s := &Sandbox{id: "test-id"}
	if got := s.ID(); got != "test-id" {
		t.Errorf("ID() = %q, want test-id", got)
	}
}

func TestSandbox_Execute_Closed(t *testing.T) {
	s := &Sandbox{
		id:     "test",
		closed: true,
	}

	_, err := s.Execute(context.Background(), "echo", "hello")
	if err == nil {
		t.Error("Execute() should error when sandbox is closed")
	}
}

func TestSandbox_Execute_RequiresRealWSL2(t *testing.T) {
	// This test can only run when WSL2 is actually available
	t.Skip("Requires real WSL2 environment")
}

func TestSandbox_Close(t *testing.T) {
	s := &Sandbox{id: "test"}

	if err := s.Close(); err != nil {
		t.Errorf("Close() error = %v", err)
	}

	if !s.closed {
		t.Error("closed should be true after Close()")
	}

	// Closing again should not error
	if err := s.Close(); err != nil {
		t.Errorf("Close() second call error = %v", err)
	}
}

func TestSandbox_InterfaceCompliance(t *testing.T) {
	var _ platform.SandboxManager = (*SandboxManager)(nil)
	var _ platform.Sandbox = (*Sandbox)(nil)
}
