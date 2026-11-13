package api

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/netmonitor"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

const restrictivePolicyYAML = `version: 1
name: guarded
file_rules:
  - name: deny-secrets
    paths: ["/secrets/**"]
    operations: ["*"]
    decision: deny
network_rules:
  - name: allow-registry
    domains: ["registry.example.com"]
    ports: [443]
    decision: allow
command_rules:
  - name: allow-all
    commands: ["*"]
    decision: allow
`

const commandOnlyPolicyYAML = `version: 1
name: commands
command_rules:
  - name: allow-all
    commands: ["*"]
    decision: allow
`

func requireLinuxGaps(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("the enforcement check judges the Linux backends")
	}
}

func boolRef(v bool) *bool { return &v }

func restrictivePolicy(t *testing.T) *policy.Policy {
	t.Helper()
	p, err := policy.LoadFromBytes([]byte(restrictivePolicyYAML))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestEnforcementGaps_NoBackends(t *testing.T) {
	requireLinuxGaps(t)
	cfg := &config.Config{}
	gaps := EnforcementGaps(cfg, restrictivePolicy(t))
	if len(gaps) != 2 {
		t.Fatalf("gaps = %v, want one for file_rules and one for network_rules", gaps)
	}
	if !strings.HasPrefix(gaps[0], "file_rules") || !strings.HasPrefix(gaps[1], "network_rules") {
		t.Fatalf("gaps = %v", gaps)
	}
}

func TestEnforcementGaps_ShippedBackendsCoverBoth(t *testing.T) {
	requireLinuxGaps(t)
	if !seccompFileMonitorBuilt {
		t.Skip("this build carries no seccomp file monitor")
	}
	cfg := &config.Config{}
	cfg.Sandbox.UnixSockets.Enabled = boolRef(true)
	cfg.Sandbox.Seccomp.FileMonitor.Enabled = boolRef(true)
	cfg.Sandbox.Seccomp.FileMonitor.EnforceWithoutFUSE = boolRef(true)
	cfg.Sandbox.Network.EBPF.Enabled = true
	cfg.Sandbox.Network.EBPF.Enforce = true
	if gaps := EnforcementGaps(cfg, restrictivePolicy(t)); len(gaps) != 0 {
		t.Fatalf("gaps = %v, want none", gaps)
	}
}

// Backends that do not refuse an operation do not count.
func TestEnforcementGaps_AdvisoryBackendsDoNotCount(t *testing.T) {
	requireLinuxGaps(t)
	cfg := &config.Config{}
	cfg.Sandbox.UnixSockets.Enabled = boolRef(true)
	// The file monitor without enforce_without_fuse only records.
	cfg.Sandbox.Seccomp.FileMonitor.Enabled = boolRef(true)
	cfg.Sandbox.Seccomp.FileMonitor.EnforceWithoutFUSE = boolRef(false)
	// FUSE covers the workspace mount only.
	cfg.Sandbox.FUSE.Enabled = true
	// The explicit proxy is bypassed by a client that ignores HTTP_PROXY.
	cfg.Sandbox.Network.Enabled = true
	// eBPF without enforce only observes.
	cfg.Sandbox.Network.EBPF.Enabled = true
	if gaps := EnforcementGaps(cfg, restrictivePolicy(t)); len(gaps) != 2 {
		t.Fatalf("gaps = %v, want both rule kinds unenforced", gaps)
	}
}

func TestEnforcementGaps_LandlockNeedsKernel(t *testing.T) {
	requireLinuxGaps(t)
	prev := detectLandlock
	t.Cleanup(func() { detectLandlock = prev })
	cfg := &config.Config{}
	cfg.Sandbox.UnixSockets.Enabled = boolRef(true)
	cfg.Landlock.Enabled = true
	cfg.Sandbox.Network.Transparent.Enabled = true

	detectLandlock = func() bool { return false }
	if gaps := EnforcementGaps(cfg, restrictivePolicy(t)); len(gaps) != 1 || !strings.HasPrefix(gaps[0], "file_rules") {
		t.Fatalf("without Landlock in the kernel: gaps = %v, want the file_rules gap", gaps)
	}
	detectLandlock = func() bool { return true }
	if gaps := EnforcementGaps(cfg, restrictivePolicy(t)); len(gaps) != 0 {
		t.Fatalf("with Landlock: gaps = %v, want none", gaps)
	}
}

func TestEnforcementGaps_UnrestrictivePolicyNeedsNothing(t *testing.T) {
	requireLinuxGaps(t)
	p, err := policy.LoadFromBytes([]byte(commandOnlyPolicyYAML))
	if err != nil {
		t.Fatal(err)
	}
	if gaps := EnforcementGaps(&config.Config{}, p); len(gaps) != 0 {
		t.Fatalf("gaps = %v, want none for a policy without file or network rules", gaps)
	}
}

func TestCheckPolicyEnforcement_DegradedSwitch(t *testing.T) {
	requireLinuxGaps(t)
	cfg := &config.Config{}
	err := CheckPolicyEnforcement(cfg, restrictivePolicy(t))
	if err == nil || !strings.Contains(err.Error(), ruleUnenforcedPolicyRules) {
		t.Fatalf("err = %v, want the %s refusal", err, ruleUnenforcedPolicyRules)
	}
	cfg.Sandbox.AllowDegraded = true
	if err := CheckPolicyEnforcement(cfg, restrictivePolicy(t)); err != nil {
		t.Fatalf("allow_degraded must accept the gap: %v", err)
	}
}

// The shipped server config enforces file and network rules on Linux.
func TestShippedServerConfigHasBackends(t *testing.T) {
	requireLinuxGaps(t)
	if !seccompFileMonitorBuilt {
		t.Skip("this build carries no seccomp file monitor")
	}
	cfg, err := config.Load(filepath.Join("..", "..", "configs", "server-config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	b := activeEnforcementBackends(cfg)
	if len(b.File) == 0 || len(b.Network) == 0 {
		t.Fatalf("shipped backends = %+v, want a file and a network backend", b)
	}
	if !cfg.Sandbox.Seccomp.Execve.Enabled {
		t.Fatal("the shipped config must enforce nested execs")
	}
	if cfg.Sandbox.AllowDegraded {
		t.Fatal("the shipped config must not run degraded")
	}
	if !cfg.Sandbox.Network.EBPF.Enforce || !cfg.Sandbox.Network.EBPF.Required {
		t.Fatal("the shipped eBPF backend must enforce and be required")
	}
}

// sessionTestApp builds an App whose policy dir holds one policy.
func sessionTestApp(t *testing.T, cfg *config.Config, policyYAML string) *App {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "default.yaml"), []byte(policyYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg.Policies.Dir = dir
	cfg.Policies.Default = "default"
	cfg.Sessions.BaseDir = filepath.Join(t.TempDir(), "sessions")
	app, _ := guardTestApp(t, cfg)
	return app
}

func TestCreateSession_RefusesUnenforceablePolicy(t *testing.T) {
	requireLinuxGaps(t)
	app := sessionTestApp(t, &config.Config{}, restrictivePolicyYAML)
	_, code, err := app.createSessionCore(context.Background(), types.CreateSessionRequest{Workspace: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), ruleUnenforcedPolicyRules) {
		t.Fatalf("err = %v, want the %s refusal", err, ruleUnenforcedPolicyRules)
	}
	if code != 500 {
		t.Fatalf("code = %d, want 500", code)
	}
	if n := app.sessions.Count(); n != 0 {
		t.Fatalf("sessions = %d after the refusal, want 0", n)
	}

	degraded := &config.Config{}
	degraded.Sandbox.AllowDegraded = true
	app = sessionTestApp(t, degraded, restrictivePolicyYAML)
	if _, _, err := app.createSessionCore(context.Background(), types.CreateSessionRequest{Workspace: t.TempDir()}); err != nil {
		t.Fatalf("allow_degraded session: %v", err)
	}
}

// CAWA-08: a network interceptor that fails to start fails the session.
func TestCreateSession_FailsWhenProxyCannotStart(t *testing.T) {
	cfg := &config.Config{}
	cfg.Sandbox.Network.Enabled = true
	cfg.Sandbox.Network.ProxyListenAddr = "256.256.256.256:0"
	app := sessionTestApp(t, cfg, commandOnlyPolicyYAML)
	_, _, err := app.createSessionCore(context.Background(), types.CreateSessionRequest{Workspace: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "network proxy failed to start") {
		t.Fatalf("err = %v, want the proxy start failure", err)
	}
	if n := app.sessions.Count(); n != 0 {
		t.Fatalf("sessions = %d after the failed start, want 0", n)
	}

	degraded := &config.Config{}
	degraded.Sandbox.AllowDegraded = true
	degraded.Sandbox.Network.Enabled = true
	degraded.Sandbox.Network.ProxyListenAddr = "256.256.256.256:0"
	app = sessionTestApp(t, degraded, commandOnlyPolicyYAML)
	if _, _, err := app.createSessionCore(context.Background(), types.CreateSessionRequest{Workspace: t.TempDir()}); err != nil {
		t.Fatalf("allow_degraded keeps the session without the proxy: %v", err)
	}
}

// CAWA-08 acceptance: transparent mode with a failing netns setup fails the
// session and leaves no session that could run a command.
func TestCreateSession_FailsWhenTransparentNetworkCannotStart(t *testing.T) {
	prev := setupTransparentNetNS
	t.Cleanup(func() { setupTransparentNetNS = prev })
	setupTransparentNetNS = func(ctx context.Context, nsName, subnetCIDR, hostIf, nsIf, hostIPCIDR, nsIPCIDR string, proxyTCPPort, dnsUDPPort int, torRedirectPorts []int) (*netmonitor.NetNS, error) {
		return nil, errors.New("transparent netns requires root")
	}
	cfg := &config.Config{}
	cfg.Sandbox.Network.Transparent.Enabled = true
	app := sessionTestApp(t, cfg, restrictivePolicyYAML)
	if runtime.GOOS == "linux" {
		// The policy needs a file backend; the test is about the network one.
		app.cfg.Sandbox.UnixSockets.Enabled = boolRef(true)
		app.cfg.Landlock.Enabled = true
		prevLL := detectLandlock
		t.Cleanup(func() { detectLandlock = prevLL })
		detectLandlock = func() bool { return true }
	}
	_, _, err := app.createSessionCore(context.Background(), types.CreateSessionRequest{Workspace: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "transparent network interception failed to start") {
		t.Fatalf("err = %v, want the transparent start failure", err)
	}
	if n := app.sessions.Count(); n != 0 {
		t.Fatalf("sessions = %d after the failed start, want 0", n)
	}
}
