package kerneldock

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// startStubDock binds a Unix socket at <base>/<suffix> and answers every line
// with the given text after an optional delay. An empty answer leaves the
// connection open and silent, which is the silent-dock case.
func startStubDock(t *testing.T, base, suffix, answer string, delay time.Duration) string {
	t.Helper()
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatalf("mkdir socket base: %v", err)
	}
	path := filepath.Join(base, suffix)
	_ = os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatalf("listen unix %s: %v", path, err)
	}
	t.Cleanup(func() {
		_ = ln.Close()
		_ = os.Remove(path)
	})
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 256)
				_, _ = c.Read(buf)
				if delay > 0 {
					time.Sleep(delay)
				}
				if answer != "" {
					_, _ = c.Write([]byte(answer))
				}
			}(conn)
		}
	}()
	return path
}

func TestProbePassesOnPong(t *testing.T) {
	base := t.TempDir()
	startStubDock(t, base, "validation", "{\"ok\":true,\"pong\":true}\n", 0)
	if err := Probe(Options{SocketBase: base, Dock: DefaultDock, Timeout: time.Second}); err != nil {
		t.Fatalf("Probe on an answering dock = %v, want nil", err)
	}
}

func TestProbeRefusesMissingSocket(t *testing.T) {
	base := filepath.Join(t.TempDir(), "sockets")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	want := filepath.Join(base, "validation")
	err := Probe(Options{SocketBase: base, Dock: DefaultDock, Timeout: 500 * time.Millisecond})
	assertRefusal(t, err, "validation_engine", want)
}

func TestProbeRefusesSilentSocket(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", "", 2*time.Second)
	err := Probe(Options{SocketBase: base, Dock: DefaultDock, Timeout: 200 * time.Millisecond})
	ref := assertRefusal(t, err, "validation_engine", want)
	var netErr net.Error
	if !errors.As(ref.Cause, &netErr) || !netErr.Timeout() {
		t.Fatalf("silent dock cause = %v, want a timeout", ref.Cause)
	}
}

func TestProbeRefusesDockError(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", "{\"ok\":false,\"error\":\"frame missing\"}\n", 0)
	err := Probe(Options{SocketBase: base, Dock: DefaultDock, Timeout: time.Second})
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "frame missing") {
		t.Fatalf("refusal = %q, want the dock error text", ref.Error())
	}
}

func TestProbeRefusesNonPingAnswer(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", "not json\n", 0)
	err := Probe(Options{SocketBase: base, Dock: DefaultDock, Timeout: time.Second})
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "not a ping response") {
		t.Fatalf("refusal = %q, want a ping response complaint", ref.Error())
	}
}

func TestProbeRefusesUnknownDock(t *testing.T) {
	err := Probe(Options{SocketBase: t.TempDir(), Dock: "board", Timeout: time.Second})
	if err == nil {
		t.Fatal("Probe with an unknown dock = nil, want a refusal")
	}
	var ref *Refusal
	if !errors.As(err, &ref) {
		t.Fatalf("Probe error = %T, want *Refusal", err)
	}
	if !strings.Contains(err.Error(), "unknown kernel dock") {
		t.Fatalf("refusal = %q, want an unknown dock complaint", err.Error())
	}
}

func TestRefusalNamesRuleDockAndSocket(t *testing.T) {
	base := t.TempDir()
	want := filepath.Join(base, "validation")
	ref := &Refusal{Dock: DefaultDock, Socket: want, Cause: errors.New("dial unix: no such file or directory")}
	msg := ref.Error()
	for _, part := range []string{"rule=" + Rule, "dock=" + DefaultDock, "socket=" + want} {
		if !strings.Contains(msg, part) {
			t.Fatalf("refusal %q does not carry %q", msg, part)
		}
	}
	if !errors.Is(ref, ref.Cause) {
		t.Fatal("Refusal must unwrap to its cause")
	}
}

func TestResolveSocketBase(t *testing.T) {
	explicit := t.TempDir()
	if got := ResolveSocketBase(explicit); got != explicit {
		t.Fatalf("ResolveSocketBase(explicit) = %q, want %q", got, explicit)
	}

	t.Setenv("AEP_SOCKET_BASE", filepath.Join(t.TempDir(), "env-base"))
	t.Setenv("AEP_DATA", filepath.Join(t.TempDir(), "env-data"))
	if got := ResolveSocketBase(""); got != os.Getenv("AEP_SOCKET_BASE") {
		t.Fatalf("ResolveSocketBase = %q, want the AEP_SOCKET_BASE value", got)
	}

	t.Setenv("AEP_SOCKET_BASE", "")
	if got := ResolveSocketBase(""); got != filepath.Join(os.Getenv("AEP_DATA"), "sockets") {
		t.Fatalf("ResolveSocketBase = %q, want AEP_DATA/sockets", got)
	}

	t.Setenv("AEP_DATA", "")
	home := filepath.Join(t.TempDir(), "home")
	t.Setenv("HOME", home)
	if got := ResolveSocketBase(""); got != filepath.Join(home, ".aep", "sockets") {
		t.Fatalf("ResolveSocketBase = %q, want HOME/.aep/sockets", got)
	}
}

func TestSocketPathCoversEveryDock(t *testing.T) {
	base := t.TempDir()
	want := map[string]string{
		"inference_engine":  "inference",
		"validation_engine": "validation",
		"future_features":   "future",
		"regulation_module": "regulation",
	}
	if len(DockPorts()) != len(want) {
		t.Fatalf("DockPorts() = %v, want the four Base Node docks", DockPorts())
	}
	for dock, suffix := range want {
		got, err := SocketPath(base, dock)
		if err != nil {
			t.Fatalf("SocketPath(%s): %v", dock, err)
		}
		if got != filepath.Join(base, suffix) {
			t.Fatalf("SocketPath(%s) = %q, want %q", dock, got, filepath.Join(base, suffix))
		}
	}
	if _, err := SocketPath(base, ""); err == nil {
		t.Fatal("SocketPath with an empty dock = nil error, want a complaint")
	}
}

func assertRefusal(t *testing.T, err error, wantDock, wantSocket string) *Refusal {
	t.Helper()
	if err == nil {
		t.Fatal("Probe = nil, want a refusal")
	}
	var ref *Refusal
	if !errors.As(err, &ref) {
		t.Fatalf("Probe error = %T (%v), want *Refusal", err, err)
	}
	if ref.Dock != wantDock {
		t.Fatalf("refusal dock = %q, want %q", ref.Dock, wantDock)
	}
	if ref.Socket != wantSocket {
		t.Fatalf("refusal socket = %q, want %q", ref.Socket, wantSocket)
	}
	if !strings.Contains(ref.Error(), "rule="+Rule) {
		t.Fatalf("refusal = %q, want the rule name", ref.Error())
	}
	return ref
}
