//go:build linux && cgo

package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/client"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/limits"
	ebpftrace "github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/netmonitor/ebpf"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

// enforcementTestEnv turns every missing host precondition of the shipped
// config test into a failure. CI sets it on the root runner step, so the test
// can never pass there by skipping (AEP-CRV-040).
const enforcementTestEnv = "AEP_CAW_ENFORCEMENT_TEST"

// unroutedTarget is an address of TEST-NET-1 (RFC 5737). No rule of the shipped
// default policy names it, so only the default deny of the network backend can
// refuse the connect.
const unroutedTarget = "192.0.2.1"

func enforcementHostOrSkip(t *testing.T, format string, args ...any) {
	t.Helper()
	msg := fmt.Sprintf(format, args...)
	if os.Getenv(enforcementTestEnv) == "1" {
		t.Fatalf("%s (%s=1 makes this a failure)", msg, enforcementTestEnv)
	}
	t.Skip(msg)
}

// buildShippedWrapper compiles aep-caw-unixwrap, the seccomp wrapper the
// shipped config runs every command through.
func buildShippedWrapper(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "aep-caw-unixwrap")
	cmd := exec.Command("go", "build", "-o", bin, "./cmd/aep-caw-unixwrap")
	cmd.Dir = filepath.Join("..", "..")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=1")
	if out, err := cmd.CombinedOutput(); err != nil {
		enforcementHostOrSkip(t, "build aep-caw-unixwrap: %v\n%s", err, out)
	}
	return bin
}

func freeLoopbackAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return addr
}

// loadInstalledServerConfig loads configs/server-config.yaml, the file the
// stack installs as the CAW runtime config. Only the host locations change:
// data and log paths move to a temp dir, the listener moves to loopback, the
// API key is minted per run and the kernel dock check, which needs a running
// base node, is off. Every sandbox setting stays as shipped.
func loadInstalledServerConfig(t *testing.T, wrapperBin string) (*config.Config, string) {
	t.Helper()
	cfg, err := config.Load(filepath.Join("..", "..", "configs", "server-config.yaml"))
	if err != nil {
		t.Fatalf("load shipped configs/server-config.yaml: %v", err)
	}
	data := t.TempDir()
	keyBytes := make([]byte, 24)
	if _, err := rand.Read(keyBytes); err != nil {
		t.Fatal(err)
	}
	key := hex.EncodeToString(keyBytes)
	keysFile := filepath.Join(data, "api_keys.yaml")
	if err := os.WriteFile(keysFile, []byte("- id: test\n  key: \""+key+"\"\n  role: admin\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg.Auth.APIKey.KeysFile = keysFile
	cfg.Server.HTTP.Addr = freeLoopbackAddr(t)
	cfg.Server.GRPC.Enabled = false
	cfg.Logging.Output = filepath.Join(data, "server.log")
	cfg.Audit.Output = filepath.Join(data, "audit.jsonl")
	cfg.Audit.Storage.SQLitePath = filepath.Join(data, "events.db")
	cfg.Sessions.BaseDir = filepath.Join(data, "sessions")
	cfg.Policies.Dir = filepath.Join("..", "..", "configs", "policies")
	cfg.Sandbox.UnixSockets.WrapperBin = wrapperBin
	off := false
	cfg.KernelDock.Enabled = &off
	return cfg, key
}

// TestShippedConfigEnforcesDefaultPolicy is the acceptance check of AEP-CRV-040:
// with the server config the stack installs and the shipped default policy, a
// read of a path under deny-ssh-keys and a connect to an address no rule names
// both fail, and each leaves exactly one deny event.
func TestShippedConfigEnforcesDefaultPolicy(t *testing.T) {
	if os.Geteuid() != 0 {
		enforcementHostOrSkip(t, "the shipped eBPF network backend needs root")
	}
	if !limits.DetectCgroupV2() {
		enforcementHostOrSkip(t, "the shipped eBPF network backend needs cgroup v2")
	}
	if st := ebpftrace.CheckSupport(); !st.Supported {
		enforcementHostOrSkip(t, "eBPF unsupported: %s", st.Reason)
	}
	if _, err := exec.LookPath("bash"); err != nil {
		enforcementHostOrSkip(t, "bash is needed for the connect probe: %v", err)
	}
	if _, err := exec.LookPath("cat"); err != nil {
		enforcementHostOrSkip(t, "cat is needed for the read probe: %v", err)
	}

	wrapper := buildShippedWrapper(t)
	cfg, key := loadInstalledServerConfig(t, wrapper)

	s, err := New(cfg)
	if err != nil {
		t.Fatalf("server start with the shipped config: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	runErr := make(chan error, 1)
	go func() { runErr <- s.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-runErr:
		case <-time.After(10 * time.Second):
		}
		_ = s.Close()
	})

	cli := client.New("http://"+cfg.Server.HTTP.Addr, key)
	waitHealthy(t, cli, cfg.Server.HTTP.Addr)

	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".ssh"), 0o700); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(home, ".ssh", "id_crv040")
	if err := os.WriteFile(secret, []byte("not a real key\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	workspace := t.TempDir()

	sess, err := cli.CreateSessionWithRequest(ctx, types.CreateSessionRequest{
		Workspace: workspace,
		Policy:    "default",
		Home:      home,
	})
	if err != nil {
		t.Fatalf("create session with the shipped default policy: %v", err)
	}

	t.Run("denied file read", func(t *testing.T) {
		resp := execOrFail(t, cli, sess.ID, types.ExecRequest{Command: "cat", Args: []string{secret}})
		if resp.Result.ExitCode == 0 {
			t.Fatalf("cat of %s ran: stdout=%q", secret, resp.Result.Stdout)
		}
		if strings.Contains(resp.Result.Stdout, "not a real key") {
			t.Fatalf("the denied file content reached stdout: %q", resp.Result.Stdout)
		}
		denies := waitForEvents(t, cli, sess.ID, func(ev types.Event) bool {
			return ev.Path == secret && ev.Policy != nil && ev.Policy.Decision == types.DecisionDeny &&
				ev.EffectiveAction == "blocked"
		})
		if len(denies) != 1 {
			t.Fatalf("deny events for %s = %d, want 1: %+v", secret, len(denies), denies)
		}
		if !strings.Contains(denies[0].Policy.Rule, "deny-ssh-keys") {
			t.Fatalf("deny event rule = %q, want deny-ssh-keys", denies[0].Policy.Rule)
		}
	})

	t.Run("denied connect", func(t *testing.T) {
		probe := "exec 3<>/dev/tcp/" + unroutedTarget + "/9"
		resp := execOrFail(t, cli, sess.ID, types.ExecRequest{Command: "bash", Args: []string{"-c", probe}})
		if resp.Result.ExitCode == 0 {
			t.Fatalf("connect to %s:9 succeeded", unroutedTarget)
		}
		// EPERM is the answer of the BPF connect program. A missing route would
		// answer with an unreachable network or a timeout instead.
		if !strings.Contains(resp.Result.Stderr, "Operation not permitted") {
			t.Fatalf("connect to %s:9 failed without a policy refusal: stderr=%q", unroutedTarget, resp.Result.Stderr)
		}
		remote := net.JoinHostPort(unroutedTarget, "9")
		denies := waitForEvents(t, cli, sess.ID, func(ev types.Event) bool {
			return ev.Type == "net_connect_blocked" && ev.Remote == remote
		})
		if len(denies) != 1 {
			t.Fatalf("deny events for %s = %d, want 1: %+v", remote, len(denies), denies)
		}
		if denies[0].Policy == nil || denies[0].Policy.Decision != types.DecisionDeny {
			t.Fatalf("net_connect_blocked event carries no deny decision: %+v", denies[0])
		}
	})
}

func waitHealthy(t *testing.T, cli *client.Client, addr string) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			_, err = cli.ListSessions(ctx)
			cancel()
			if err == nil {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("server at %s did not answer", addr)
}

func execOrFail(t *testing.T, cli *client.Client, sessionID string, req types.ExecRequest) types.ExecResponse {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp, err := cli.Exec(ctx, sessionID, req)
	if err != nil {
		t.Fatalf("exec %s %v: %v", req.Command, req.Args, err)
	}
	return resp
}

// waitForEvents polls the session events until at least one matches, then
// waits a short settle time so a duplicate event would also be counted. Events
// are written after the notify answer, so they can trail the exec response.
func waitForEvents(t *testing.T, cli *client.Client, sessionID string, match func(types.Event) bool) []types.Event {
	t.Helper()
	collect := func() []types.Event {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		evs, err := cli.QuerySessionEvents(ctx, sessionID, url.Values{"limit": []string{"5000"}})
		if err != nil {
			t.Fatalf("query session events: %v", err)
		}
		var out []types.Event
		for _, ev := range evs {
			if match(ev) {
				out = append(out, ev)
			}
		}
		return out
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if got := collect(); len(got) > 0 {
			time.Sleep(time.Second)
			return collect()
		}
		time.Sleep(200 * time.Millisecond)
	}
	return collect()
}
