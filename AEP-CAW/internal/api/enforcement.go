package api

import (
	"fmt"
	"log/slog"
	"runtime"
	"strings"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/capabilities"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/netmonitor"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
)

// Rule name of the refusal when a policy holds rules that no active backend
// enforces (AEP-CRV-040).
const ruleUnenforcedPolicyRules = "unenforced-policy-rules"

// enforcementBackends names the backends of a config that consult the policy
// for file and network operations of a wrapped command.
type enforcementBackends struct {
	File    []string
	Network []string
}

// detectLandlock is a seam for tests; Landlock availability is a kernel fact.
var detectLandlock = func() bool { return capabilities.DetectLandlock().Available }

// setupTransparentNetNS is a seam for tests: the real netns setup needs root
// together with ip and iptables.
var setupTransparentNetNS = netmonitor.SetupNetNS

// seccompWrapperActive reports whether commands run under aep-caw-unixwrap,
// the seccomp wrapper that carries the file monitor and the Landlock ruleset.
// Full ptrace mode skips the wrapper (see setupSeccompWrapper).
func seccompWrapperActive(cfg *config.Config) bool {
	if cfg.Sandbox.UnixSockets.Enabled == nil || !*cfg.Sandbox.UnixSockets.Enabled {
		return false
	}
	return !cfg.Sandbox.Ptrace.Enabled || cfg.Sandbox.Ptrace.IsExecveOnly()
}

// activeEnforcementBackends lists the file and network backends a config turns
// on. Only backends that refuse an operation the policy denies count: the
// explicit HTTP proxy is advisory (a client that ignores HTTP_PROXY bypasses
// it), FUSE covers the workspace mount only and a seccomp file monitor without
// enforce_without_fuse only records.
func activeEnforcementBackends(cfg *config.Config) enforcementBackends {
	var b enforcementBackends
	if cfg == nil || runtime.GOOS != "linux" {
		return b
	}
	fm := cfg.Sandbox.Seccomp.FileMonitor
	if seccompFileMonitorBuilt && seccompWrapperActive(cfg) &&
		config.FileMonitorBoolWithDefault(fm.Enabled, false) &&
		config.FileMonitorBoolWithDefault(fm.EnforceWithoutFUSE, false) {
		b.File = append(b.File, "seccomp file monitor")
	}
	if cfg.Landlock.Enabled && seccompWrapperActive(cfg) && detectLandlock() {
		b.File = append(b.File, "landlock")
	}
	if cfg.Sandbox.Ptrace.Enabled && cfg.Sandbox.Ptrace.Trace.File {
		b.File = append(b.File, "ptrace file tracing")
	}
	if cfg.Sandbox.Network.EBPF.Enabled && cfg.Sandbox.Network.EBPF.Enforce {
		b.Network = append(b.Network, "ebpf enforce")
	}
	if cfg.Sandbox.Network.Transparent.Enabled {
		b.Network = append(b.Network, "transparent network")
	}
	if cfg.Sandbox.Ptrace.Enabled && cfg.Sandbox.Ptrace.Trace.Network {
		b.Network = append(b.Network, "ptrace network tracing")
	}
	return b
}

// EnforcementGaps lists the rule kinds of p that no active backend of cfg
// enforces. The check covers the Linux backends of this tree. Other platforms
// enforce through their own system mechanisms and are not judged here.
func EnforcementGaps(cfg *config.Config, p *policy.Policy) []string {
	if cfg == nil || p == nil || runtime.GOOS != "linux" {
		return nil
	}
	b := activeEnforcementBackends(cfg)
	var gaps []string
	if p.RestrictsFiles() && len(b.File) == 0 {
		gaps = append(gaps, "file_rules have no active backend "+
			"(enable sandbox.seccomp.file_monitor with enforce_without_fuse, landlock or ptrace file tracing)")
	}
	if p.RestrictsNetwork() && len(b.Network) == 0 {
		gaps = append(gaps, "network_rules have no active backend "+
			"(enable sandbox.network.ebpf with enforce, sandbox.network.transparent or ptrace network tracing)")
	}
	return gaps
}

// CheckPolicyEnforcement refuses a policy whose file or network rules no active
// backend enforces. With sandbox.allow_degraded the operator accepts the gap:
// the check logs every gap and lets the policy run.
func CheckPolicyEnforcement(cfg *config.Config, p *policy.Policy) error {
	gaps := EnforcementGaps(cfg, p)
	if len(gaps) == 0 {
		return nil
	}
	name := ""
	if p != nil {
		name = p.Name
	}
	if cfg.Sandbox.AllowDegraded {
		for _, g := range gaps {
			slog.Warn("policy rules run unenforced (sandbox.allow_degraded)", "policy", name, "gap", g)
		}
		return nil
	}
	return fmt.Errorf("%s: policy %q holds rules this server cannot enforce: %s; "+
		"set sandbox.allow_degraded: true to run them unenforced",
		ruleUnenforcedPolicyRules, name, strings.Join(gaps, "; "))
}
