package api

import (
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
)

// CAWA-14: io_uring is blocked whenever a notify-based control is active,
// not only with the file monitor, because io_uring operations never pass the
// seccomp filter.
func TestBuildSeccompWrapperConfig_BlockIOUringFollowsNotifyControls(t *testing.T) {
	cfg := &config.Config{}
	app := newTestAppForSeccomp(t, cfg)

	if got := app.buildSeccompWrapperConfig(nil, seccompWrapperParams{}); got.BlockIOUring {
		t.Fatal("no notify control: io_uring stays open")
	}
	for name, p := range map[string]seccompWrapperParams{
		"unix sockets":  {UnixSocketEnabled: true},
		"execve":        {ExecveEnabled: true},
		"signal filter": {SignalFilterEnabled: true},
	} {
		if got := app.buildSeccompWrapperConfig(nil, p); !got.BlockIOUring {
			t.Fatalf("%s: io_uring must be blocked", name)
		}
	}

	off := false
	cfg.Sandbox.Seccomp.FileMonitor.BlockIOUring = &off
	if got := app.buildSeccompWrapperConfig(nil, seccompWrapperParams{UnixSocketEnabled: true}); got.BlockIOUring {
		t.Fatal("an explicit block_io_uring: false is honored")
	}
}
