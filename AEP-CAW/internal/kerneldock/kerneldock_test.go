package kerneldock

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// startStubDock binds a Unix socket at <base>/<suffix> and answers every
// request line with handle(line). An empty answer leaves the connection open
// and silent until delay passes, which is the silent-dock case.
func startStubDock(t *testing.T, base, suffix string, delay time.Duration, handle func(line string) string) string {
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
				line, _ := bufio.NewReader(c).ReadString('\n')
				answer := handle(line)
				if answer == "" {
					time.Sleep(delay)
					return
				}
				_, _ = c.Write([]byte(answer))
			}(conn)
		}
	}()
	return path
}

// fakeSealer writes a stand-in for aep-lattice-log that records its arguments
// and stdin and prints the given envelope, or fails when exitCode is not zero.
func fakeSealer(t *testing.T, envelope string, exitCode int) (bin, argsFile, stdinFile string) {
	t.Helper()
	dir := t.TempDir()
	bin = filepath.Join(dir, "aep-lattice-log")
	argsFile = filepath.Join(dir, "args")
	stdinFile = filepath.Join(dir, "stdin")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' \"$@\" > '" + argsFile + "'\n" +
		"cat > '" + stdinFile + "'\n"
	if exitCode != 0 {
		script += "echo 'sign key store poisoned' >&2\nexit 3\n"
	} else {
		script += "cat <<'ENVELOPE'\n" + envelope + "\nENVELOPE\n"
	}
	if err := os.WriteFile(bin, []byte(script), 0o700); err != nil {
		t.Fatalf("write fake sealer: %v", err)
	}
	return bin, argsFile, stdinFile
}

const goodEnvelope = `{"frame":{"channel_id":"ch-caw-kernel-dock","sealed":"stub"},"signer_public_hex":"abcd"}`

// admittingDock answers the sealed frame as held for the pulse and the first
// collect of its digest as admitted. It records every request line.
func admittingDock(lines *[]string, mu *sync.Mutex) func(string) string {
	return func(line string) string {
		mu.Lock()
		*lines = append(*lines, strings.TrimSpace(line))
		mu.Unlock()
		if strings.Contains(line, "\"collect\"") {
			return "{\"ok\":true,\"event_id\":7,\"digest\":\"d1\"}\n"
		}
		return "{\"ok\":false,\"pending\":true,\"digest\":\"d1\"}\n"
	}
}

func baseOptions(t *testing.T, base, bin string, timeout time.Duration) Options {
	return Options{
		SocketBase:    base,
		Dock:          DefaultDock,
		Timeout:       timeout,
		LatticeLogBin: bin,
		LatticeDB:     filepath.Join(t.TempDir(), "action-lattice.db"),
	}
}

func TestProbePassesWhenTheSealedPingIsAdmitted(t *testing.T) {
	base := t.TempDir()
	var lines []string
	var mu sync.Mutex
	startStubDock(t, base, "validation", 0, admittingDock(&lines, &mu))
	bin, argsFile, stdinFile := fakeSealer(t, goodEnvelope, 0)
	opts := baseOptions(t, base, bin, 2*time.Second)
	if err := Probe(opts); err != nil {
		t.Fatalf("Probe on an admitting dock = %v, want nil", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(lines) != 2 {
		t.Fatalf("dock saw %d requests, want the frame then one collect: %v", len(lines), lines)
	}
	var sent struct {
		Frame           json.RawMessage `json:"frame"`
		SignerPublicHex string          `json:"signer_public_hex"`
	}
	if err := json.Unmarshal([]byte(lines[0]), &sent); err != nil || len(sent.Frame) == 0 || sent.SignerPublicHex != "abcd" {
		t.Fatalf("first request = %q, want the sealed frame with its signer key", lines[0])
	}
	if lines[1] != `{"collect":"d1"}` {
		t.Fatalf("second request = %q, want a collect of the held digest", lines[1])
	}
	for _, l := range lines {
		if strings.Contains(l, "\"ping\"") {
			t.Fatalf("probe sent a plain ping %q, the docks refuse that side channel", l)
		}
	}
	args, _ := os.ReadFile(argsFile)
	if got := strings.Fields(string(args)); strings.Join(got, " ") != "--db "+opts.LatticeDB+" build-frame" {
		t.Fatalf("sealer args = %v, want --db <lattice db> build-frame", got)
	}
	stdin, _ := os.ReadFile(stdinFile)
	var ev map[string]any
	if err := json.Unmarshal(stdin, &ev); err != nil {
		t.Fatalf("sealer stdin is not JSON: %v", err)
	}
	if ev["agent_id"] != DefaultAgent || ev["action_path"] != "root:ping" || ev["docking_port"] != DefaultDock {
		t.Fatalf("sealed event = %v, want root:ping as %s on %s", ev, DefaultAgent, DefaultDock)
	}
}

func TestProbeRefusesMissingSocket(t *testing.T) {
	base := filepath.Join(t.TempDir(), "sockets")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	bin, _, _ := fakeSealer(t, goodEnvelope, 0)
	want := filepath.Join(base, "validation")
	err := Probe(baseOptions(t, base, bin, 500*time.Millisecond))
	assertRefusal(t, err, "validation_engine", want)
}

func TestProbeRefusesSilentSocket(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", 2*time.Second, func(string) string { return "" })
	bin, _, _ := fakeSealer(t, goodEnvelope, 0)
	err := Probe(baseOptions(t, base, bin, 300*time.Millisecond))
	ref := assertRefusal(t, err, "validation_engine", want)
	var netErr net.Error
	if !errors.As(ref.Cause, &netErr) || !netErr.Timeout() {
		t.Fatalf("silent dock cause = %v, want a timeout", ref.Cause)
	}
}

func TestProbeRefusesDockDeny(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", 0, func(string) string {
		return "{\"ok\":false,\"error\":\"task manifest missing for agent_id=caw-kernel-dock\"}\n"
	})
	bin, _, _ := fakeSealer(t, goodEnvelope, 0)
	err := Probe(baseOptions(t, base, bin, time.Second))
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "task manifest missing") {
		t.Fatalf("refusal = %q, want the dock deny text", ref.Error())
	}
}

func TestProbeRefusesDenyReportWithoutErrorText(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", 0, func(line string) string {
		if strings.Contains(line, "\"collect\"") {
			return "{\"ok\":false,\"deny\":{\"closed\":[{\"id\":\"agent.permission\",\"reason\":\"root:ping not granted\"}]}}\n"
		}
		return "{\"ok\":false,\"pending\":true,\"digest\":\"d2\"}\n"
	})
	bin, _, _ := fakeSealer(t, goodEnvelope, 0)
	err := Probe(baseOptions(t, base, bin, 2*time.Second))
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "agent.permission root:ping not granted") {
		t.Fatalf("refusal = %q, want the closed wall and its reason", ref.Error())
	}
}

func TestProbeRefusesAPingPendingPastTheDeadline(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", 0, func(string) string {
		return "{\"ok\":false,\"pending\":true,\"digest\":\"d3\"}\n"
	})
	bin, _, _ := fakeSealer(t, goodEnvelope, 0)
	err := Probe(baseOptions(t, base, bin, 500*time.Millisecond))
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "pending") {
		t.Fatalf("refusal = %q, want a pending complaint", ref.Error())
	}
}

func TestProbeRefusesNonDockAnswer(t *testing.T) {
	base := t.TempDir()
	want := startStubDock(t, base, "validation", 0, func(string) string { return "not json\n" })
	bin, _, _ := fakeSealer(t, goodEnvelope, 0)
	err := Probe(baseOptions(t, base, bin, time.Second))
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "not a dock response") {
		t.Fatalf("refusal = %q, want a dock response complaint", ref.Error())
	}
}

func TestProbeRefusesWhenSealingFails(t *testing.T) {
	base := t.TempDir()
	want := filepath.Join(base, "validation")
	bin, _, _ := fakeSealer(t, "", 3)
	err := Probe(baseOptions(t, base, bin, time.Second))
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "sign key store poisoned") {
		t.Fatalf("refusal = %q, want the sealer error text", ref.Error())
	}
}

func TestProbeRefusesWithoutASignKey(t *testing.T) {
	base := t.TempDir()
	want := filepath.Join(base, "validation")
	bin, _, _ := fakeSealer(t, `{"frame":{"sealed":"stub"},"signer_public_hex":""}`, 0)
	err := Probe(baseOptions(t, base, bin, time.Second))
	ref := assertRefusal(t, err, "validation_engine", want)
	if !strings.Contains(ref.Error(), "no sign key for agent "+DefaultAgent) {
		t.Fatalf("refusal = %q, want a missing sign key complaint", ref.Error())
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

func TestResolveLatticeDBAndSealer(t *testing.T) {
	sockets := filepath.Join(t.TempDir(), "data", "sockets")
	if got := ResolveLatticeDB("/x/explicit.db", sockets); got != "/x/explicit.db" {
		t.Fatalf("ResolveLatticeDB(explicit) = %q", got)
	}
	t.Setenv("AEP_LATTICE_DB", "/x/env.db")
	if got := ResolveLatticeDB("", sockets); got != "/x/env.db" {
		t.Fatalf("ResolveLatticeDB = %q, want the AEP_LATTICE_DB value", got)
	}
	t.Setenv("AEP_LATTICE_DB", "")
	t.Setenv("AEP_DATA", "/x/data")
	if got := ResolveLatticeDB("", sockets); got != "/x/data/action-lattice.db" {
		t.Fatalf("ResolveLatticeDB = %q, want AEP_DATA/action-lattice.db", got)
	}
	t.Setenv("AEP_DATA", "")
	if got := ResolveLatticeDB("", sockets); got != filepath.Join(filepath.Dir(sockets), "action-lattice.db") {
		t.Fatalf("ResolveLatticeDB = %q, want action-lattice.db next to the socket base", got)
	}

	if got := ResolveLatticeLogBin("/x/bin"); got != "/x/bin" {
		t.Fatalf("ResolveLatticeLogBin(explicit) = %q", got)
	}
	t.Setenv("AEP_LATTICE_LOG_BIN", "/x/env-bin")
	if got := ResolveLatticeLogBin(""); got != "/x/env-bin" {
		t.Fatalf("ResolveLatticeLogBin = %q, want the AEP_LATTICE_LOG_BIN value", got)
	}
	t.Setenv("AEP_LATTICE_LOG_BIN", "")
	if got := ResolveLatticeLogBin(""); got != DefaultLatticeLogBin {
		t.Fatalf("ResolveLatticeLogBin = %q, want %q", got, DefaultLatticeLogBin)
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
