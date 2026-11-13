//go:build linux

package capabilities

import (
	"strings"
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/limits"
)

// resetCgroupProbeCache clears the package-level cache between tests.
func resetCgroupProbeCache(t *testing.T) {
	t.Helper()
	prev := cgroupProbeCache
	t.Cleanup(func() { cgroupProbeCache = prev })
}

func TestCheckCgroupsV2ResourceLimits_NestedAvailable(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{
		Mode:   limits.ModeNested,
		Reason: "test fixture",
	})
	r := realCheckCgroupsV2ResourceLimits()
	if !r.Available {
		t.Errorf("Nested should be Available=true; got %+v", r)
	}
	if r.Feature != "cgroups_v2_resource_limits" {
		t.Errorf("Feature: got %q, want %q", r.Feature, "cgroups_v2_resource_limits")
	}
}

func TestCheckCgroupsV2ResourceLimits_TopLevelAvailable(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{
		Mode:   limits.ModeTopLevel,
		Reason: "test fixture",
	})
	r := realCheckCgroupsV2ResourceLimits()
	if !r.Available {
		t.Errorf("TopLevel should be Available=true; got %+v", r)
	}
}

func TestCheckCgroupsV2ResourceLimits_AttachOnly_NotAvailable(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{
		Mode:   limits.ModeAttachOnly,
		Reason: "attach-only test fixture",
	})
	r := realCheckCgroupsV2ResourceLimits()
	if r.Available {
		t.Errorf("AttachOnly should NOT report resource_limits Available; got %+v", r)
	}
}

func TestCheckCgroupsV2ResourceLimits_Unavailable(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{
		Mode:   limits.ModeUnavailable,
		Reason: "test fixture",
	})
	r := realCheckCgroupsV2ResourceLimits()
	if r.Available {
		t.Errorf("Unavailable should NOT report Available; got %+v", r)
	}
}

func TestCheckEBPFCgroupAttach_AttachOnlyAvailable(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{
		Mode:   limits.ModeAttachOnly,
		Reason: "test fixture",
	})
	// Stub the eBPF kernel-support probe to "supported".
	checkeBPF = func() CheckResult { return CheckResult{Feature: "ebpf", Available: true} }
	t.Cleanup(func() { checkeBPF = realCheckeBPF })

	r := realCheckEBPFCgroupAttach()
	if !r.Available {
		t.Errorf("AttachOnly + ebpf-supported should be Available=true; got %+v", r)
	}
	if r.Feature != "ebpf_cgroup_attach" {
		t.Errorf("Feature: got %q, want %q", r.Feature, "ebpf_cgroup_attach")
	}
}

func TestCheckEBPFCgroupAttach_UnavailableMode(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{
		Mode:   limits.ModeUnavailable,
		Reason: "test fixture",
	})
	checkeBPF = func() CheckResult { return CheckResult{Feature: "ebpf", Available: true} }
	t.Cleanup(func() { checkeBPF = realCheckeBPF })

	r := realCheckEBPFCgroupAttach()
	if r.Available {
		t.Errorf("Mode=Unavailable should be Available=false; got %+v", r)
	}
	if r.Error == nil || !strings.Contains(r.Error.Error(), "cgroup attach feasibility unavailable") {
		t.Errorf("Error should name cgroup-attach blocker; got %v", r.Error)
	}
}

func TestCheckEBPFCgroupAttach_KernelUnsupported(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{Mode: limits.ModeNested})
	checkeBPF = func() CheckResult { return CheckResult{Feature: "ebpf", Available: false} }
	t.Cleanup(func() { checkeBPF = realCheckeBPF })

	r := realCheckEBPFCgroupAttach()
	if r.Available {
		t.Errorf("ebpf unsupported should be Available=false; got %+v", r)
	}
	if r.Error == nil || !strings.Contains(r.Error.Error(), "eBPF kernel support unavailable") {
		t.Errorf("Error should name eBPF kernel blocker; got %v", r.Error)
	}
}

// AEP-CRV-040: with cgroups.enabled off nothing else fills the probe cache, so
// the eBPF attach check runs the probe itself. Before the fix an empty cache
// read as unavailable and eBPF enforce refused every start.
func TestCheckEBPFCgroupAttach_EmptyCacheRunsProbe(t *testing.T) {
	resetCgroupProbeCache(t)
	cgroupProbeCache = nil
	probes := 0
	prev := runCgroupProbe
	t.Cleanup(func() { runCgroupProbe = prev })
	runCgroupProbe = func() ProbeResult {
		probes++
		cacheCgroupProbe(&limits.CgroupProbeResult{Mode: limits.ModeAttachOnly, Reason: "test fixture"})
		return ProbeResult{Available: false, Detail: "attach-only"}
	}
	checkeBPF = func() CheckResult { return CheckResult{Feature: "ebpf", Available: true} }
	t.Cleanup(func() { checkeBPF = realCheckeBPF })

	r := realCheckEBPFCgroupAttach()
	if probes != 1 {
		t.Fatalf("probe runs = %d, want 1", probes)
	}
	if !r.Available {
		t.Fatalf("attach-only host must be available for eBPF; got %+v", r)
	}
}

func TestCheckEBPFCgroupAttach_ErrorNamesProbeReason(t *testing.T) {
	resetCgroupProbeCache(t)
	cacheCgroupProbe(&limits.CgroupProbeResult{Mode: limits.ModeUnavailable, Reason: "root subtree_control not writable"})
	checkeBPF = func() CheckResult { return CheckResult{Feature: "ebpf", Available: true} }
	t.Cleanup(func() { checkeBPF = realCheckeBPF })

	r := realCheckEBPFCgroupAttach()
	if r.Error == nil || !strings.Contains(r.Error.Error(), "root subtree_control not writable") {
		t.Fatalf("error must carry the probe reason; got %v", r.Error)
	}
}
