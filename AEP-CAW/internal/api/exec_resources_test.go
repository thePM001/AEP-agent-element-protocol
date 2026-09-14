package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/session"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

func TestRunCommand_ReturnsResourcesForExternalCommand(t *testing.T) {
	ws := t.TempDir()
	s := &session.Session{
		ID:        "session-test",
		Workspace: ws,
		Cwd:       "/workspace",
		Env:       map[string]string{},
	}
	s.SetWorkspaceMount(ws)

	// Ensure workdir exists.
	if err := os.MkdirAll(filepath.Join(ws, "d"), 0o755); err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{}
	req := types.ExecRequest{Command: "sh", Args: []string{"-c", "echo hi"}}

	_, _, _, _, _, _, _, res, err := runCommandWithResources(context.Background(), s, "cmd-test", req, cfg, policy.ResolvedEnvPolicy{}, 0, nil, nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.CPUUserMs < 0 || res.CPUSystemMs < 0 {
		t.Fatalf("expected non-negative cpu times, got %+v", res)
	}
	if res.MemoryPeakKB < 0 {
		t.Fatalf("expected non-negative rss, got %+v", res)
	}
}
