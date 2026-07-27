package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nla-aep/aep-caw-framework/internal/config"
	"github.com/nla-aep/aep-caw-framework/internal/events"
	"github.com/nla-aep/aep-caw-framework/internal/metrics"
	"github.com/nla-aep/aep-caw-framework/internal/policy"
	"github.com/nla-aep/aep-caw-framework/internal/session"
	"github.com/nla-aep/aep-caw-framework/internal/store/composite"
)

func TestRouter_MetricsEnabledServesPath(t *testing.T) {
	cfg := &config.Config{}
	cfg.Development.DisableAuth = true
	cfg.Metrics.Enabled = true
	cfg.Metrics.Path = "/metrics"
	cfg.Health.Path = "/health"
	cfg.Health.ReadinessPath = "/ready"

	sessions := session.NewManager(10)
	engine, err := policy.NewEngine(&policy.Policy{Version: 1, Name: "test"}, false, true)
	if err != nil {
		t.Fatal(err)
	}
	app := NewApp(cfg, sessions, composite.New(nil, nil), engine, events.NewBroker(), nil, nil, nil, metrics.New(), nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr := httptest.NewRecorder()
	app.Router().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "aep-caw_") {
		t.Fatalf("expected metrics body, got %q", rr.Body.String())
	}
}
