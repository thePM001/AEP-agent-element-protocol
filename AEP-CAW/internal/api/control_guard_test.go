package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/events"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/metrics"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/session"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/composite"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
	"google.golang.org/grpc/peer"
)

// stubResolver classifies every peer the same way.
type stubResolver struct {
	pc  peerClass
	err error
}

func (s stubResolver) classify(net.Addr, net.Addr, sessionView) (peerClass, error) {
	return s.pc, s.err
}
func (s stubResolver) classifyPID(int, sessionView) (peerClass, error) { return s.pc, s.err }

// operatorRequest builds a request the way the guard sees a loopback client.
func operatorRequest(method, target string, body []byte) *http.Request {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rd)
	req.Host = "127.0.0.1:18080"
	req.RemoteAddr = "127.0.0.1:40000"
	req = req.WithContext(context.WithValue(req.Context(), http.LocalAddrContextKey, &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 18080}))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

// loadShippedConfig loads the sample config.yml that ships in the repository.
func loadShippedConfig(t *testing.T) *config.Config {
	t.Helper()
	cfg, err := config.Load(filepath.Join("..", "..", "config.yml"))
	if err != nil {
		t.Fatalf("load shipped config.yml: %v", err)
	}
	// The shipped policy dir is relative to the repository root.
	if !filepath.IsAbs(cfg.Policies.Dir) {
		cfg.Policies.Dir = filepath.Join("..", "..", cfg.Policies.Dir)
	}
	// The shipped data paths are relative too; keep test state out of the tree.
	data := t.TempDir()
	cfg.Sessions.BaseDir = filepath.Join(data, "sessions")
	cfg.Sandbox.FUSE.MountBaseDir = filepath.Join(data, "mounts")
	// The guard tests do not cover FUSE, and a mount would outlive the test.
	cfg.Sandbox.FUSE.Enabled = false
	return cfg
}

func guardTestApp(t *testing.T, cfg *config.Config) (*App, *session.Manager) {
	t.Helper()
	engine, err := policy.NewEngine(&policy.Policy{Version: 1, Name: "test"}, false, true)
	if err != nil {
		t.Fatal(err)
	}
	mgr := session.NewManager(10)
	app := NewApp(cfg, mgr, composite.New(&capturingEventStore{}, nil), engine, events.NewBroker(), nil, nil, nil, metrics.New(), nil, nil, nil)
	return app, mgr
}

// The helper process plays a confined command. It runs only when the guard
// test starts it.
const guardHelperEnv = "AEP_CAW_GUARD_HELPER"

func TestGuardHelperProcess(t *testing.T) {
	mode := os.Getenv(guardHelperEnv)
	if mode == "" {
		t.Skip("helper process for the control guard tests")
	}
	url := os.Getenv("AEP_CAW_GUARD_URL")
	body := os.Getenv("AEP_CAW_GUARD_BODY")
	post := func() string {
		req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
		if err != nil {
			return "error " + err.Error()
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return "error " + err.Error()
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return fmt.Sprintf("%d %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	switch mode {
	case "post":
		// Wait until the parent recorded this process as a session root.
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		fmt.Println(post())
		os.Exit(0)
	case "background":
		// Leave a child in the same process group and exit, the way a
		// command returns while its background job keeps running.
		child := exec.Command(os.Args[0], "-test.run=^TestGuardHelperProcess$")
		child.Env = append(os.Environ(), guardHelperEnv+"=orphan")
		if err := child.Start(); err != nil {
			fmt.Println("error " + err.Error())
			os.Exit(1)
		}
		fmt.Println(child.Process.Pid)
		os.Exit(0)
	case "orphan":
		trigger := os.Getenv("AEP_CAW_GUARD_TRIGGER")
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := os.Stat(trigger); err == nil {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		_ = os.WriteFile(os.Getenv("AEP_CAW_GUARD_RESULT"), []byte(post()), 0o600)
		os.Exit(0)
	}
	os.Exit(2)
}

// AEP-CRV-030 proof gate (CAWB 01): under the shipped config a session
// process is refused on the session route. It runs real processes against a
// real loopback server: one that is still running, and the background child
// of a command that already returned and was reparented away from the server.
// The operator, the test process itself, still creates sessions.
func TestSessionProcessRefusedOnSessionRouteOfShippedConfig(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the session peer check reads procfs")
	}
	cfg := loadShippedConfig(t)
	if !strings.EqualFold(cfg.Auth.Type, "none") {
		t.Fatalf("shipped config auth type = %q; the test covers the shipped auth none default", cfg.Auth.Type)
	}
	app, mgr := guardTestApp(t, cfg)
	app.peerResolver = defaultPeerResolver() // the real procfs resolver
	srv := httptest.NewUnstartedServer(app.Router())
	srv.Config.ConnContext = ControlConnContext
	srv.Start()
	defer srv.Close()

	owner, err := mgr.Create(t.TempDir(), "default")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"workspace": t.TempDir(), "policy": "default"})
	sessionsURL := srv.URL + "/api/v1/sessions"

	// The operator is not a session process.
	resp, err := http.Post(sessionsURL, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("operator create session = %d %s, want success", resp.StatusCode, b)
	}
	created := mgr.Count()

	helperEnv := append(os.Environ(),
		"AEP_CAW_GUARD_URL="+sessionsURL,
		"AEP_CAW_GUARD_BODY="+string(body),
	)

	t.Run("running command", func(t *testing.T) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestGuardHelperProcess$")
		cmd.Env = append(helperEnv, guardHelperEnv+"=post")
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		stdin, _ := cmd.StdinPipe()
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		owner.SetCurrentProcessPID(cmd.Process.Pid)
		_, _ = stdin.Write([]byte("go\n"))
		_ = stdin.Close()
		if err := cmd.Wait(); err != nil {
			t.Fatalf("helper: %v (%s)", err, out.String())
		}
		got := out.String()
		if !strings.HasPrefix(got, "403 ") || !strings.Contains(got, controlRuleSessionPeer) {
			t.Fatalf("session process create session = %q, want 403 with rule %s", got, controlRuleSessionPeer)
		}
	})

	t.Run("background child of a returned command", func(t *testing.T) {
		dir := t.TempDir()
		trigger := filepath.Join(dir, "go")
		result := filepath.Join(dir, "result")
		cmd := exec.Command(os.Args[0], "-test.run=^TestGuardHelperProcess$")
		cmd.Env = append(helperEnv, guardHelperEnv+"=background",
			"AEP_CAW_GUARD_TRIGGER="+trigger, "AEP_CAW_GUARD_RESULT="+result)
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("helper: %v (%s)", err, out)
		}
		// The command root returned; record it the way exec does.
		unlock := owner.LockExec()
		owner.SetCurrentProcessPID(cmd.Process.Pid)
		unlock()
		if err := os.WriteFile(trigger, nil, 0o600); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(20 * time.Second)
		var got []byte
		for time.Now().Before(deadline) {
			if got, err = os.ReadFile(result); err == nil && len(got) > 0 {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if !strings.HasPrefix(string(got), "403 ") || !strings.Contains(string(got), controlRuleSessionPeer) {
			t.Fatalf("orphaned session process create session = %q, want 403 with rule %s", got, controlRuleSessionPeer)
		}
	})

	if mgr.Count() != created {
		t.Fatalf("sessions = %d after the refused calls, want %d", mgr.Count(), created)
	}
}

// AEP-CRV-030 (CAWB 01): the guard refuses writes without a JSON body type,
// foreign host names while auth is off, peers it cannot resolve and session
// processes, and lets a session process ask wrap-init for its own session.
func TestControlGuardDecisions(t *testing.T) {
	cfg := &config.Config{}
	cfg.Auth.Type = "none"
	cfg.Health.Path = "/health"
	cfg.Health.ReadinessPath = "/ready"
	app, mgr := guardTestApp(t, cfg)
	s, err := mgr.Create(t.TempDir(), "default")
	if err != nil {
		t.Fatal(err)
	}
	h := app.Router()
	create, _ := json.Marshal(map[string]any{"workspace": t.TempDir()})
	inSession := peerClass{SessionProcess: true, PID: 42, Sessions: map[string]struct{}{s.ID: {}}, Reason: "test"}

	cases := []struct {
		name     string
		resolver peerResolver
		req      func() *http.Request
		want     int
	}{
		{"operator creates a session", stubResolver{}, func() *http.Request {
			return operatorRequest(http.MethodPost, "/api/v1/sessions", create)
		}, http.StatusCreated},
		{"text/plain write is refused", stubResolver{}, func() *http.Request {
			r := operatorRequest(http.MethodPost, "/api/v1/sessions", create)
			r.Header.Set("Content-Type", "text/plain")
			return r
		}, http.StatusUnsupportedMediaType},
		{"write without content type is refused", stubResolver{}, func() *http.Request {
			r := operatorRequest(http.MethodPost, "/api/v1/sessions/"+s.ID+"/kill/cmd-x", nil)
			return r
		}, http.StatusUnsupportedMediaType},
		{"rebinding host is refused with auth off", stubResolver{}, func() *http.Request {
			r := operatorRequest(http.MethodGet, "/api/v1/sessions", nil)
			r.Host = "attacker.example:18080"
			return r
		}, http.StatusForbidden},
		{"session process creates a session", stubResolver{pc: inSession}, func() *http.Request {
			return operatorRequest(http.MethodPost, "/api/v1/sessions", create)
		}, http.StatusForbidden},
		{"session process opens a pty", stubResolver{pc: inSession}, func() *http.Request {
			return operatorRequest(http.MethodGet, "/api/v1/sessions/"+s.ID+"/pty", nil)
		}, http.StatusForbidden},
		{"session process ends a session", stubResolver{pc: inSession}, func() *http.Request {
			return operatorRequest(http.MethodDelete, "/api/v1/sessions/"+s.ID, nil)
		}, http.StatusForbidden},
		{"session process reads its sessions", stubResolver{pc: inSession}, func() *http.Request {
			return operatorRequest(http.MethodGet, "/api/v1/sessions", nil)
		}, http.StatusOK},
		{"session process asks a policy test", stubResolver{pc: inSession}, func() *http.Request {
			return operatorRequest(http.MethodPost, "/api/v1/policy/test", []byte(`{"operation":"exec","path":"ls"}`))
		}, http.StatusOK},
		{"session process wrap-init on another session", stubResolver{pc: peerClass{SessionProcess: true, PID: 42, Sessions: map[string]struct{}{"other": {}}}}, func() *http.Request {
			return operatorRequest(http.MethodPost, "/api/v1/sessions/"+s.ID+"/wrap-init", []byte(`{}`))
		}, http.StatusForbidden},
		{"server descendant of no known session wrap-init", stubResolver{pc: peerClass{SessionProcess: true, PID: 42, Sessions: map[string]struct{}{}}}, func() *http.Request {
			return operatorRequest(http.MethodPost, "/api/v1/sessions/"+s.ID+"/wrap-init", []byte(`{}`))
		}, http.StatusForbidden},
		{"unresolvable peer is refused", stubResolver{err: errors.New("no procfs")}, func() *http.Request {
			return operatorRequest(http.MethodPost, "/api/v1/sessions", create)
		}, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app.peerResolver = tc.resolver
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, tc.req())
			if rr.Code != tc.want {
				t.Fatalf("status = %d (%s), want %d", rr.Code, rr.Body.String(), tc.want)
			}
		})
	}

	// A session process may ask wrap-init for its own session: the guard
	// lets it through to the handler, whatever the handler then answers.
	app.peerResolver = stubResolver{pc: inSession}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, operatorRequest(http.MethodPost, "/api/v1/sessions/"+s.ID+"/wrap-init", []byte(`{}`)))
	if strings.Contains(rr.Body.String(), controlRuleSessionPeer) {
		t.Fatalf("own-session wrap-init was refused by the guard: %d %s", rr.Code, rr.Body.String())
	}
}

// AEP-CRV-030 (CAWB 01): every gRPC method that changes state refuses a
// session process before authentication; reads pass.
func TestGRPCGuardRefusesSessionProcesses(t *testing.T) {
	cfg := &config.Config{}
	cfg.Auth.Type = "none"
	app, _ := guardTestApp(t, cfg)
	app.peerResolver = stubResolver{pc: peerClass{SessionProcess: true, PID: 7, Reason: "test"}}
	ctx := peerContext(t)
	for name := range grpcStateChanging {
		if err := app.grpcGuard(ctx, "/aepcaw.v1.AepCaw/"+name); err == nil || !strings.Contains(err.Error(), "session process") {
			t.Errorf("%s: guard = %v, want the session process refusal", name, err)
		}
	}
	for _, name := range []string{"GetSession", "ListSessions", "QueryEvents", "PolicyTest"} {
		if err := app.grpcGuard(ctx, "/aepcaw.v1.AepCaw/"+name); err != nil {
			t.Errorf("%s: guard = %v, want nil for a read", name, err)
		}
	}
	app.peerResolver = stubResolver{}
	if err := app.grpcGuard(ctx, "/aepcaw.v1.AepCaw/CreateSession"); err != nil {
		t.Fatalf("operator CreateSession: %v", err)
	}
}

func TestParseProcNetAddrAndStat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("procfs formats")
	}
	ip, port, ok := parseProcNetAddr("0100007F:4688")
	if !ok || !ip.Equal(net.IPv4(127, 0, 0, 1)) || port != 18056 {
		t.Fatalf("ipv4 = %v %d %v", ip, port, ok)
	}
	ip, port, ok = parseProcNetAddr("00000000000000000000000001000000:0050")
	if !ok || !ip.Equal(net.IPv6loopback) || port != 80 {
		t.Fatalf("ipv6 = %v %d %v", ip, port, ok)
	}
	ip, _, ok = parseProcNetAddr("0000000000000000FFFF00000100007F:0050")
	if !ok || !ip.Equal(net.IPv4(127, 0, 0, 1)) {
		t.Fatalf("v4 mapped = %v %v", ip, ok)
	}
	for _, bad := range []string{"", "0100007F", "XYZ:0050", "0100007F:ZZZZ", "01:0050"} {
		if _, _, ok := parseProcNetAddr(bad); ok {
			t.Errorf("parseProcNetAddr(%q) accepted", bad)
		}
	}
	st, ok := parseProcStat("1234 (a (b) c) S 10 20 30 0 -1")
	if !ok || st.ppid != 10 || st.pgid != 20 || st.sid != 30 {
		t.Fatalf("stat = %+v %v", st, ok)
	}
}

// AEP-CRV-030 (CAWB 01): every policy a session runs under denies the server
// addresses, exactly enough that no allow rule of the policy outranks it.
func TestSealControlPlaneDeniesServerAddresses(t *testing.T) {
	base := &policy.Policy{
		Version: 1, Name: "lenient",
		NetworkRules: []policy.NetworkRule{
			{Name: "allow-all", Domains: []string{"**"}, Decision: "allow"},
			{Name: "allow-any-address", CIDRs: []string{"0.0.0.0/0", "::/0", "127.0.0.0/8", "127.0.0.1/32", "::1/128", "10.1.2.3/32"}, Decision: "allow"},
			{Name: "allow-localhost", Domains: []string{"localhost"}, Ports: []int{18080}, Decision: "allow"},
		},
	}
	check := func(t *testing.T, cfg *config.Config, ip string, port int, want types.Decision) {
		t.Helper()
		eng, err := policy.NewEngine(SealControlPlane(cfg, base), false, true)
		if err != nil {
			t.Fatal(err)
		}
		dec := eng.CheckNetworkIP("", net.ParseIP(ip), port)
		if dec.EffectiveDecision != want {
			t.Fatalf("%s:%d = %s (rule %s), want %s", ip, port, dec.EffectiveDecision, dec.Rule, want)
		}
	}

	t.Run("shipped config", func(t *testing.T) {
		cfg := loadShippedConfig(t)
		host, portStr, err := net.SplitHostPort(cfg.Server.HTTP.Addr)
		if err != nil {
			t.Fatal(err)
		}
		var port int
		fmt.Sscanf(portStr, "%d", &port)
		if host == "" || host == "0.0.0.0" {
			host = "127.0.0.1"
		}
		check(t, cfg, host, port, types.DecisionDeny)
		check(t, cfg, host, port+1, types.DecisionAllow)
		eng, _ := policy.NewEngine(SealControlPlane(cfg, base), false, true)
		if dec := eng.CheckNetwork("localhost", port); dec.EffectiveDecision != types.DecisionDeny {
			t.Fatalf("localhost:%d = %s, want deny", port, dec.EffectiveDecision)
		}
		if len(base.NetworkRules) != 3 {
			t.Fatal("SealControlPlane changed the policy it was given")
		}
	})

	t.Run("every interface", func(t *testing.T) {
		orig := interfaceAddrs
		interfaceAddrs = func() ([]net.Addr, error) {
			return []net.Addr{&net.IPNet{IP: net.IPv4(10, 1, 2, 3), Mask: net.CIDRMask(24, 32)}}, nil
		}
		defer func() { interfaceAddrs = orig }()
		cfg := &config.Config{}
		cfg.Server.HTTP.Addr = ":18080"
		cfg.Server.GRPC.Enabled = true
		cfg.Server.GRPC.Addr = "127.0.0.1:9090"
		check(t, cfg, "10.1.2.3", 18080, types.DecisionDeny)
		check(t, cfg, "127.0.0.1", 18080, types.DecisionDeny)
		check(t, cfg, "::1", 18080, types.DecisionDeny)
		check(t, cfg, "127.0.0.1", 9090, types.DecisionDeny)
		check(t, cfg, "10.1.2.4", 18080, types.DecisionAllow)
	})

	t.Run("unix socket listener", func(t *testing.T) {
		cfg := &config.Config{}
		cfg.Server.HTTP.Addr = "127.0.0.1:18080"
		cfg.Server.UnixSocket.Enabled = true
		cfg.Server.UnixSocket.Path = "/run/aep-caw/api.sock"
		sealed := SealControlPlane(cfg, base)
		if len(sealed.UnixRules) != 1 || sealed.UnixRules[0].Decision != "deny" || sealed.UnixRules[0].Paths[0] != "/run/aep-caw/api.sock" {
			t.Fatalf("unix rules = %+v", sealed.UnixRules)
		}
	})
}

// peerContext is a gRPC call context from a loopback client.
func peerContext(t *testing.T) context.Context {
	t.Helper()
	return peer.NewContext(context.Background(), &peer.Peer{
		Addr:      &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 40000},
		LocalAddr: &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 9090},
	})
}
