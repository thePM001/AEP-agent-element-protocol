package aepsdk

import (
	"encoding/json"
	"os"
	"os/exec"
	"testing"
)

func TestBuildLatticeFrameSmoke(t *testing.T) {
	if _, err := exec.LookPath(resolveLatticeLogBin()); err != nil {
		t.Skip("aep-lattice-log not on PATH")
	}
	out, err := BuildLatticeFrame(map[string]any{
		"agent_id": "sdk-smoke", "channel_id": "ch-smoke",
		"event_type": "SDK_SMOKE", "payload": map[string]any{},
	})
	if err != nil {
		t.Fatalf("BuildLatticeFrame: %v", err)
	}
	if out["frame"] == nil {
		t.Fatalf("missing frame key: %v", out)
	}
}

func TestLatticeStrictDefault(t *testing.T) {
	os.Unsetenv("AEP_LATTICE_STRICT")
	os.Unsetenv("AEP_LATTICE_STRICT_DEV")
	strict, err := latticeStrictEnabled()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strict {
		t.Fatal("expected strict default")
	}
}

func TestLatticeStrictZeroRefusedWithoutDev(t *testing.T) {
	t.Setenv("AEP_LATTICE_STRICT", "0")
	os.Unsetenv("AEP_LATTICE_STRICT_DEV")
	_, err := latticeStrictEnabled()
	if err == nil {
		t.Fatal("expected fail-closed error for STRICT=0 without DEV")
	}
}

func TestLatticeStrictZeroAllowedWithDev(t *testing.T) {
	t.Setenv("AEP_LATTICE_STRICT", "0")
	t.Setenv("AEP_LATTICE_STRICT_DEV", "1")
	strict, err := latticeStrictEnabled()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strict {
		t.Fatal("expected non-strict when DEV=1")
	}
	_ = json.Marshal
}