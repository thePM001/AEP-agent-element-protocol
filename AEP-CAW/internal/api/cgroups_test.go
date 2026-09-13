package api

import (
	"context"
	"errors"
	"testing"

	"github.com/nla-aep/aep-caw-framework/internal/config"
	"github.com/nla-aep/aep-caw-framework/internal/events"
	"github.com/nla-aep/aep-caw-framework/internal/limits"
	"github.com/nla-aep/aep-caw-framework/internal/policy"
	"github.com/nla-aep/aep-caw-framework/internal/session"
	"github.com/nla-aep/aep-caw-framework/internal/store/composite"
)

func TestApplyCgroupV2_EBPFEnabledRequiresCgroupManager(t *testing.T) {
	cfg := &config.Config{}
	cfg.Sandbox.Cgroups.Enabled = true
	cfg.Sandbox.Network.EBPF.Enabled = true

	app := NewApp(
		cfg,
		session.NewManager(1),
		composite.New(mockEventStore{}, nil),
		nil,
		events.NewBroker(),
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
	)

	_, err := applyCgroupV2(context.Background(), storeEmitter{store: app.store, broker: app.broker}, app, "sess", "cmd", 1234, policy.Limits{}, nil, nil)
	if err == nil {
		t.Fatal("expected error when ebpf is enabled without cgroup manager")
	}
	var unavailable *limits.CgroupUnavailableError
	if !errors.As(err, &unavailable) {
		t.Fatalf("expected CgroupUnavailableError, got %T: %v", err, err)
	}
}
