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
	if !latticeStrictEnabled() {
		t.Fatal("expected strict default")
	}
	_ = json.Marshal
}