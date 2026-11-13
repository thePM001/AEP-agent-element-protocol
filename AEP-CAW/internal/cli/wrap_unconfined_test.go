//go:build !windows

package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/client"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

// stubWrapClient makes runWrap use mc instead of a real API client.
func stubWrapClient(t *testing.T, mc *mockWrapClient) {
	t.Helper()
	orig := newWrapClientFn
	t.Cleanup(func() { newWrapClientFn = orig })
	newWrapClientFn = func(client.CLIOptions) (client.CLIClient, error) { return mc, nil }
}

// stubWrapGOOS makes runWrap treat the host as goos.
func stubWrapGOOS(t *testing.T, goos string) {
	t.Helper()
	orig := wrapGOOS
	t.Cleanup(func() { wrapGOOS = orig })
	wrapGOOS = goos
}

// markerAgentOptions returns wrap options whose agent creates a marker file
// when it runs, plus the marker path. The agent exits 0 so runWrap does not
// call os.Exit.
func markerAgentOptions(t *testing.T, allowUnconfined bool, stderr *bytes.Buffer) (wrapOptions, string) {
	t.Helper()
	dir := t.TempDir()
	marker := filepath.Join(dir, "agent-ran")
	return wrapOptions{
		root:            dir,
		policy:          "agent-default",
		report:          false,
		agentCmd:        "/bin/sh",
		agentArgs:       []string{"-c", "touch \"$0\"", marker},
		allowUnconfined: allowUnconfined,
		stderr:          stderr,
	}, marker
}

func newSessionMock() *mockWrapClient {
	return &mockWrapClient{
		createSessionFn: func(ctx context.Context, req types.CreateSessionRequest) (types.Session, error) {
			return types.Session{ID: "wrap-test-session"}, nil
		},
	}
}

func assertAgentNotStarted(t *testing.T, marker string) {
	t.Helper()
	_, err := os.Stat(marker)
	assert.True(t, os.IsNotExist(err), "agent must not start without interception; marker stat err=%v", err)
}

func assertAgentStarted(t *testing.T, marker string) {
	t.Helper()
	_, err := os.Stat(marker)
	assert.NoError(t, err, "agent should have started with --allow-unconfined")
}

func TestWrapCmd_DefaultAllowUnconfinedFalse(t *testing.T) {
	cmd := newWrapCmd()
	v, err := cmd.Flags().GetBool("allow-unconfined")
	require.NoError(t, err)
	assert.False(t, v)
}

func TestRunWrap_WrapInitFailureWithoutAllowUnconfinedRefuses(t *testing.T) {
	mc := newSessionMock()
	mc.wrapInitErr = assert.AnError
	stubWrapClient(t, mc)

	var stderr bytes.Buffer
	opts, marker := markerAgentOptions(t, false, &stderr)
	err := runWrap(context.Background(), &clientConfig{serverAddr: "http://127.0.0.1:18080"}, opts)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "interception setup failed")
	assert.Contains(t, err.Error(), "wrap-init")
	assert.Contains(t, err.Error(), "--allow-unconfined")
	assert.True(t, mc.wrapInitCalled)
	assertAgentNotStarted(t, marker)
	assert.NotContains(t, stderr.String(), "running without interception")
}

func TestRunWrap_WrapInitFailureWithAllowUnconfinedRunsAgentWithWarning(t *testing.T) {
	mc := newSessionMock()
	mc.wrapInitErr = assert.AnError
	stubWrapClient(t, mc)

	var stderr bytes.Buffer
	opts, marker := markerAgentOptions(t, true, &stderr)
	err := runWrap(context.Background(), &clientConfig{serverAddr: "http://127.0.0.1:18080"}, opts)

	require.NoError(t, err)
	assertAgentStarted(t, marker)
	out := stderr.String()
	assert.Contains(t, out, "WARNING")
	assert.Contains(t, out, "--allow-unconfined")
	assert.Contains(t, out, "wrap-init")
	assert.Contains(t, out, "without exec interception")
}

func TestRunWrap_EmptyWrapperBinaryWithoutAllowUnconfinedRefuses(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("an empty wrapper binary is a setup failure only on Linux")
	}
	mc := newSessionMock()
	mc.wrapInitResp = types.WrapInitResponse{EnvPolicy: &types.EnvPolicyWire{}}
	stubWrapClient(t, mc)

	var stderr bytes.Buffer
	opts, marker := markerAgentOptions(t, false, &stderr)
	err := runWrap(context.Background(), &clientConfig{serverAddr: "http://127.0.0.1:18080"}, opts)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty wrapper binary")
	assert.Contains(t, err.Error(), "--allow-unconfined")
	assertAgentNotStarted(t, marker)
}

func TestRunWrap_UnsupportedOSWithoutAllowUnconfinedRefuses(t *testing.T) {
	mc := newSessionMock()
	stubWrapClient(t, mc)
	stubWrapGOOS(t, "plan9")

	var stderr bytes.Buffer
	opts, marker := markerAgentOptions(t, false, &stderr)
	err := runWrap(context.Background(), &clientConfig{serverAddr: "http://127.0.0.1:18080"}, opts)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "interception setup failed")
	assert.Contains(t, err.Error(), "plan9")
	assert.Contains(t, err.Error(), "--allow-unconfined")
	assert.False(t, mc.wrapInitCalled, "wrap-init must not be called on an unsupported OS")
	assertAgentNotStarted(t, marker)
}

func TestRunWrap_UnsupportedOSWithAllowUnconfinedRunsAgentWithWarning(t *testing.T) {
	mc := newSessionMock()
	stubWrapClient(t, mc)
	stubWrapGOOS(t, "plan9")

	var stderr bytes.Buffer
	opts, marker := markerAgentOptions(t, true, &stderr)
	err := runWrap(context.Background(), &clientConfig{serverAddr: "http://127.0.0.1:18080"}, opts)

	require.NoError(t, err)
	assertAgentStarted(t, marker)
	out := stderr.String()
	assert.Contains(t, out, "WARNING")
	assert.Contains(t, out, "plan9")
	assert.Contains(t, out, "without exec interception")
}
