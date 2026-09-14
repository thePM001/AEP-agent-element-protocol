package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/events"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/kerneldock"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/session"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/composite"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

// startKernelDockStub binds the validation dock of a socket base and answers
// one ping with the pong the Base Node dock documents.
func startKernelDockStub(t *testing.T, socketBase string) string {
	t.Helper()
	if err := os.MkdirAll(socketBase, 0o700); err != nil {
		t.Fatalf("mkdir socket base: %v", err)
	}
	path := filepath.Join(socketBase, "validation")
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
				_, _ = c.Write([]byte("{\"ok\":true,\"pong\":true}\n"))
			}(conn)
		}
	}()
	return path
}

// kernelDockFixture wires an App that runs the kernel dock check over a chosen
// socket base, with a capturing store so the refusal evidence is readable.
type kernelDockFixture struct {
	app        *App
	session    *session.Session
	captured   *capturingEventStore
	socketBase string
	cmdPath    string
}

func newKernelDockFixture(t *testing.T, enabled bool, socketBase string) *kernelDockFixture {
	t.Helper()
	cmdPath := strings.ToLower(filepath.ToSlash(filepath.Join(t.TempDir(), "aep-caw-kernel-dock-missing")))

	p := &policy.Policy{
		Version: 1,
		Name:    "kernel-dock-test",
		CommandRules: []policy.CommandRule{
			{Name: "allow-all", Commands: []string{"*"}, Decision: "allow"},
		},
		FileRules: []policy.FileRule{
			{Name: "allow-all", Paths: []string{"/**"}, Operations: []string{"*"}, Decision: "allow"},
		},
		NetworkRules: []policy.NetworkRule{
			{Name: "allow-all", Domains: []string{"**"}, Decision: "allow"},
		},
	}
	engine, err := policy.NewEngine(p, false, true)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}

	mgr := session.NewManager(5)
	captured := &capturingEventStore{}
	store := composite.New(captured, nil)

	cfg := &config.Config{}
	cfg.Development.DisableAuth = true
	cfg.Sandbox.FUSE.Enabled = false
	cfg.Sandbox.Network.Enabled = false
	cfg.Policies.Default = "default"
	cfg.KernelDock.Enabled = &enabled
	cfg.KernelDock.SocketBase = socketBase
	cfg.KernelDock.Dock = kerneldock.DefaultDock
	cfg.KernelDock.Timeout = "300ms"

	app := NewApp(cfg, mgr, store, engine, events.NewBroker(), nil, nil, nil, nil, nil, nil, nil)
	s, err := mgr.Create(t.TempDir(), "default")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	return &kernelDockFixture{app: app, session: s, captured: captured, socketBase: socketBase, cmdPath: cmdPath}
}

func (f *kernelDockFixture) refusalEvents() []types.Event {
	var out []types.Event
	for _, ev := range f.captured.events {
		if ev.Type == "kernel_dock_refused" {
			out = append(out, ev)
		}
	}
	return out
}

func (f *kernelDockFixture) precheckEvents() []types.Event {
	var out []types.Event
	for _, ev := range f.captured.events {
		if ev.Operation == "command_precheck" {
			out = append(out, ev)
		}
	}
	return out
}

// assertRefused checks that err is the named kernel dock refusal.
func assertRefused(t *testing.T, err error, wantSocket string) *kerneldock.Refusal {
	t.Helper()
	if err == nil {
		t.Fatal("exec = nil error, want the kernel dock refusal")
	}
	var ref *kerneldock.Refusal
	if !errors.As(err, &ref) {
		t.Fatalf("exec error = %T (%v), want *kerneldock.Refusal", err, err)
	}
	if ref.Socket != wantSocket {
		t.Fatalf("refusal socket = %q, want %q", ref.Socket, wantSocket)
	}
	if !strings.Contains(ref.Error(), "rule="+kerneldock.Rule) {
		t.Fatalf("refusal = %q, want the rule name", ref.Error())
	}
	return ref
}

// assertNotRefused checks that the gate let the call through to the policy
// precheck, which is the observable step after the gate.
func assertNotRefused(t *testing.T, f *kernelDockFixture, err error) {
	t.Helper()
	var ref *kerneldock.Refusal
	if errors.As(err, &ref) {
		t.Fatalf("exec was refused by the kernel dock gate: %v", err)
	}
	if len(f.refusalEvents()) != 0 {
		t.Fatalf("refusal events = %d, want 0", len(f.refusalEvents()))
	}
	if len(f.precheckEvents()) == 0 {
		t.Fatal("no command_precheck event, so the gate did not pass the call through")
	}
}

func TestExecInSessionCoreRefusesWhenKernelDockIsSilent(t *testing.T) {
	socketBase := filepath.Join(t.TempDir(), "sockets")
	if err := os.MkdirAll(socketBase, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	wantSocket := filepath.Join(socketBase, "validation")
	f := newKernelDockFixture(t, true, socketBase)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	resp, code, err := f.app.execInSessionCore(ctx, f.session.ID, types.ExecRequest{Command: f.cmdPath})

	if resp != nil {
		t.Fatalf("resp = %+v, want nil on refusal", resp)
	}
	if code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want %d", code, http.StatusServiceUnavailable)
	}
	ref := assertRefused(t, err, wantSocket)
	if ref.Dock != kerneldock.DefaultDock {
		t.Fatalf("refusal dock = %q, want %q", ref.Dock, kerneldock.DefaultDock)
	}
	events := f.refusalEvents()
	if len(events) != 1 {
		t.Fatalf("refusal events = %d, want one", len(events))
	}
	if got := events[0].Fields["dock"]; got != kerneldock.DefaultDock {
		t.Fatalf("event dock field = %v, want %q", got, kerneldock.DefaultDock)
	}
	if got := events[0].Fields["socket"]; got != wantSocket {
		t.Fatalf("event socket field = %v, want %q", got, wantSocket)
	}
	if got := events[0].Fields["rule"]; got != kerneldock.Rule {
		t.Fatalf("event rule field = %v, want %q", got, kerneldock.Rule)
	}
	if got := events[0].EffectiveAction; got != "deny" {
		t.Fatalf("event action = %q, want deny", got)
	}
	if len(f.precheckEvents()) != 0 {
		t.Fatal("the policy precheck ran, so the dock gate sits after the precheck instead of before it")
	}
}

func TestExecInSessionCorePassesWhenKernelDockAnswers(t *testing.T) {
	socketBase := filepath.Join(t.TempDir(), "sockets")
	startKernelDockStub(t, socketBase)
	f := newKernelDockFixture(t, true, socketBase)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := f.app.execInSessionCore(ctx, f.session.ID, types.ExecRequest{Command: f.cmdPath})

	assertNotRefused(t, f, err)
}

func TestExecInSessionCorePassesWhenKernelDockCheckIsOff(t *testing.T) {
	f := newKernelDockFixture(t, false, filepath.Join(t.TempDir(), "absent-sockets"))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := f.app.execInSessionCore(ctx, f.session.ID, types.ExecRequest{Command: f.cmdPath})

	assertNotRefused(t, f, err)
}

func TestExecInSessionStreamRefusesWhenKernelDockIsSilent(t *testing.T) {
	socketBase := filepath.Join(t.TempDir(), "sockets")
	if err := os.MkdirAll(socketBase, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	f := newKernelDockFixture(t, true, socketBase)

	body, err := json.Marshal(types.ExecRequest{Command: f.cmdPath})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, "POST", "/api/v1/sessions/"+f.session.ID+"/exec/stream", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", f.session.ID)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rr := httptest.NewRecorder()

	f.app.execInSessionStream(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusServiceUnavailable)
	}
	if !strings.Contains(rr.Body.String(), kerneldock.Rule) {
		t.Fatalf("stream body = %q, want the named refusal", rr.Body.String())
	}
	if len(f.precheckEvents()) != 0 {
		t.Fatal("the streamed precheck ran, so the dock gate sits after the precheck")
	}
}

func TestStartPTYRefusesWhenKernelDockIsSilent(t *testing.T) {
	socketBase := filepath.Join(t.TempDir(), "sockets")
	if err := os.MkdirAll(socketBase, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	wantSocket := filepath.Join(socketBase, "validation")
	f := newKernelDockFixture(t, true, socketBase)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	run, code, err := f.app.startPTY(ctx, f.session.ID, ptyStartParams{Command: f.cmdPath})

	if run != nil {
		t.Fatalf("pty run = %+v, want nil on refusal", run)
	}
	if code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want %d", code, http.StatusServiceUnavailable)
	}
	assertRefused(t, err, wantSocket)
	if len(f.precheckEvents()) != 0 {
		t.Fatal("the PTY precheck ran, so the dock gate sits after the precheck")
	}
}
