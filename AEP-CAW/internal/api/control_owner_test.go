package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/auth"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/events"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/metrics"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/policy"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/session"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/composite"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// queryingEventStore keeps events and answers queries by session and command.
type queryingEventStore struct {
	events []types.Event
}

func (q *queryingEventStore) AppendEvent(_ context.Context, ev types.Event) error {
	q.events = append(q.events, ev)
	return nil
}

func (q *queryingEventStore) QueryEvents(_ context.Context, f types.EventQuery) ([]types.Event, error) {
	var out []types.Event
	for _, ev := range q.events {
		if f.SessionID != "" && ev.SessionID != f.SessionID {
			continue
		}
		if f.CommandID != "" && ev.CommandID != f.CommandID {
			continue
		}
		out = append(out, ev)
		if f.Limit > 0 && len(out) >= f.Limit {
			break
		}
	}
	return out, nil
}

func (q *queryingEventStore) Close() error { return nil }

type twoKeyFixture struct {
	app   *App
	mgr   *session.Manager
	store *queryingEventStore
	h     http.Handler
}

// newTwoKeyFixture serves the API with api_key auth and two agent keys and
// one admin key. Every peer is an operator process.
func newTwoKeyFixture(t *testing.T, mutate func(*config.Config)) *twoKeyFixture {
	t.Helper()
	keys := filepath.Join(t.TempDir(), "keys.yaml")
	if err := os.WriteFile(keys, []byte(`
- id: a
  key: sk-key-a
  role: agent
- id: b
  key: sk-key-b
  role: agent
- id: admin
  key: sk-key-admin
  role: admin
`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Auth.Type = "api_key"
	cfg.Auth.APIKey.KeysFile = keys
	cfg.Auth.APIKey.HeaderName = "X-API-Key"
	cfg.Health.Path = "/health"
	cfg.Health.ReadinessPath = "/ready"
	cfg.Policies.Default = "default"
	if mutate != nil {
		mutate(cfg)
	}
	apiKeys, err := auth.LoadAPIKeys(keys, "X-API-Key")
	if err != nil {
		t.Fatal(err)
	}
	engine, err := policy.NewEngine(&policy.Policy{
		Version: 1, Name: "test",
		CommandRules: []policy.CommandRule{{Name: "allow", Commands: []string{"*"}, Decision: "allow"}},
	}, false, true)
	if err != nil {
		t.Fatal(err)
	}
	mgr := session.NewManager(10)
	st := &queryingEventStore{}
	app := NewApp(cfg, mgr, composite.New(st, nil), engine, events.NewBroker(), apiKeys, nil, nil, metrics.New(), nil, nil, nil)
	app.peerResolver = stubResolver{}
	return &twoKeyFixture{app: app, mgr: mgr, store: st, h: app.Router()}
}

func (f *twoKeyFixture) do(t *testing.T, key, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			t.Fatal(err)
		}
	}
	req := operatorRequest(method, target, raw)
	req.Header.Set("X-API-Key", key)
	rr := httptest.NewRecorder()
	f.h.ServeHTTP(rr, req)
	return rr
}

func (f *twoKeyFixture) createSession(t *testing.T, key string, req map[string]any) (string, *httptest.ResponseRecorder) {
	t.Helper()
	if _, ok := req["workspace"]; !ok {
		req["workspace"] = t.TempDir()
	}
	rr := f.do(t, key, http.MethodPost, "/api/v1/sessions", req)
	var out struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	return out.ID, rr
}

func keyContext(key, role string) context.Context {
	ctx := context.WithValue(context.Background(), ctxKeyRole, role)
	return context.WithValue(ctx, ctxKeyOperatorID, operatorIDFromAPIKey(key))
}

// AEP-CRV-030 (CAWB 03): a second key can neither read nor end the session
// of the first, on any session route or gRPC method. The owner and the admin
// keep access.
func TestSecondKeyCannotReadOrEndFirstKeysSession(t *testing.T) {
	f := newTwoKeyFixture(t, nil)
	idA, rr := f.createSession(t, "sk-key-a", map[string]any{})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create as key a = %d %s", rr.Code, rr.Body.String())
	}
	sp := "/api/v1/sessions/" + idA
	trace := map[string]any{"trace_id": "0af7651916cd43dd8448eb211c80319c", "span_id": "b7ad6b7169203331", "trace_flags": "01"}
	routes := []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, sp, nil},
		{http.MethodPatch, sp, map[string]any{}},
		{http.MethodPost, sp + "/exec", map[string]any{"command": "true"}},
		{http.MethodPost, sp + "/exec/stream", map[string]any{"command": "true"}},
		{http.MethodGet, sp + "/events", nil},
		{http.MethodGet, sp + "/history", nil},
		{http.MethodGet, sp + "/proxy", nil},
		{http.MethodGet, sp + "/output/cmd-x", nil},
		{http.MethodPost, sp + "/kill/cmd-x", map[string]any{}},
		{http.MethodPost, sp + "/wrap-init", map[string]any{}},
		{http.MethodPut, sp + "/trace-context", trace},
		{http.MethodGet, "/api/v1/events/search?session_id=" + idA, nil},
		{http.MethodPost, "/api/v1/policy/test", map[string]any{"session_id": idA, "operation": "exec", "path": "ls"}},
		{http.MethodDelete, sp, nil},
	}
	for _, rt := range routes {
		if rr := f.do(t, "sk-key-b", rt.method, rt.path, rt.body); rr.Code != http.StatusForbidden {
			t.Errorf("key b %s %s = %d %s, want 403", rt.method, rt.path, rr.Code, rr.Body.String())
		}
	}
	// The PTY route refuses before the websocket upgrade.
	req := operatorRequest(http.MethodGet, sp+"/pty", nil)
	req.Header.Set("X-API-Key", "sk-key-b")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	// Any 16 byte nonce, built at run time so no key shaped literal sits in the tree.
	req.Header.Set("Sec-WebSocket-Key", base64.StdEncoding.EncodeToString([]byte("aep-caw-ws-nonce")))
	ptyRR := httptest.NewRecorder()
	f.h.ServeHTTP(ptyRR, req)
	if ptyRR.Code != http.StatusForbidden {
		t.Errorf("key b pty = %d, want 403", ptyRR.Code)
	}
	if list := f.do(t, "sk-key-b", http.MethodGet, "/api/v1/sessions", nil); strings.Contains(list.Body.String(), idA) {
		t.Errorf("key b lists the session of key a: %s", list.Body.String())
	}

	srv := &grpcServer{app: f.app}
	ctxB := keyContext("sk-key-b", "agent")
	in := func(m map[string]any) *structpb.Struct {
		s, err := structpb.NewStruct(m)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	sid := map[string]any{"session_id": idA}
	unary := map[string]func() error{
		"GetSession":     func() error { _, err := srv.GetSession(ctxB, in(map[string]any{"id": idA})); return err },
		"PatchSession":   func() error { _, err := srv.PatchSession(ctxB, in(map[string]any{"id": idA})); return err },
		"DestroySession": func() error { _, err := srv.DestroySession(ctxB, in(map[string]any{"id": idA})); return err },
		"KillCommand": func() error {
			_, err := srv.KillCommand(ctxB, in(map[string]any{"session_id": idA, "command_id": "cmd-x"}))
			return err
		},
		"QueryEvents":  func() error { _, err := srv.QueryEvents(ctxB, in(sid)); return err },
		"SearchEvents": func() error { _, err := srv.SearchEvents(ctxB, in(sid)); return err },
		"OutputChunk": func() error {
			_, err := srv.OutputChunk(ctxB, in(map[string]any{"session_id": idA, "command_id": "cmd-x"}))
			return err
		},
		"PolicyTest": func() error {
			_, err := srv.PolicyTest(ctxB, in(map[string]any{"session_id": idA, "operation": "exec", "path": "ls"}))
			return err
		},
		"Exec": func() error {
			_, err := srv.Exec(ctxB, in(map[string]any{"session_id": idA, "command": "true"}))
			return err
		},
		"ExecStream": func() error {
			return srv.ExecStream(in(map[string]any{"session_id": idA, "command": "true"}), &captureServerStream{ctx: ctxB})
		},
		"EventsTail": func() error { return srv.EventsTail(in(sid), &captureServerStream{ctx: ctxB}) },
	}
	for name, call := range unary {
		if err := call(); status.Code(err) != codes.PermissionDenied {
			t.Errorf("gRPC %s as key b = %v, want PermissionDenied", name, err)
		}
	}
	// gRPC ListSessions filters like the HTTP list. Its reply cannot be
	// checked here: jsonToProto turns any JSON array into an Internal error,
	// a wire format defect older than this ticket that client and server
	// share, so only the HTTP list above proves the filter.

	// The owner and the admin keep access.
	if rr := f.do(t, "sk-key-a", http.MethodGet, sp, nil); rr.Code != http.StatusOK {
		t.Fatalf("key a get = %d", rr.Code)
	}
	if rr := f.do(t, "sk-key-admin", http.MethodGet, sp+"/history", nil); rr.Code != http.StatusOK {
		t.Fatalf("admin history = %d", rr.Code)
	}
	if _, err := srv.GetSession(keyContext("sk-key-a", "agent"), in(map[string]any{"id": idA})); err != nil {
		t.Fatalf("gRPC GetSession as key a: %v", err)
	}
	if _, ok := f.mgr.Get(idA); !ok {
		t.Fatal("a refused call ended the session of key a")
	}
}

// AEP-CRV-030 (CAWB 03): output is stored by command id, so a key cannot read
// the output of a command of another session through its own session.
func TestOutputOfAnotherSessionsCommandIsNotServed(t *testing.T) {
	f := newTwoKeyFixture(t, nil)
	idA, _ := f.createSession(t, "sk-key-a", map[string]any{})
	idB, _ := f.createSession(t, "sk-key-b", map[string]any{})
	f.store.events = append(f.store.events, types.Event{SessionID: idA, CommandID: "cmd-of-a", Type: "command_started"})

	if f.app.commandInSession(keyContext("sk-key-b", "agent"), idB, "cmd-of-a") {
		t.Fatal("cmd-of-a counted as a command of session b")
	}
	if !f.app.commandInSession(keyContext("sk-key-a", "agent"), idA, "cmd-of-a") {
		t.Fatal("cmd-of-a not found in session a")
	}
	rr := f.do(t, "sk-key-b", http.MethodGet, "/api/v1/sessions/"+idB+"/output/cmd-of-a", nil)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("key b output of cmd-of-a through its own session = %d %s, want 404", rr.Code, rr.Body.String())
	}
	srv := &grpcServer{app: f.app}
	in, _ := structpb.NewStruct(map[string]any{"session_id": idB, "command_id": "cmd-of-a"})
	if _, err := srv.OutputChunk(keyContext("sk-key-b", "agent"), in); status.Code(err) != codes.NotFound {
		t.Fatalf("gRPC OutputChunk = %v, want NotFound", err)
	}
	ev := f.do(t, "sk-key-b", http.MethodGet, "/api/v1/events/search", nil)
	if strings.Contains(ev.Body.String(), idA) {
		t.Fatalf("key b search shows events of session a: %s", ev.Body.String())
	}
}

// AEP-CRV-030 (CAWB 02): a caller below admin names only the default policy
// or one in policies.allowed, and no caller gets the filesystem root.
func TestSessionPolicyAllowedListAndRootWorkspace(t *testing.T) {
	policyDir, err := filepath.Abs(filepath.Join("..", "..", "configs", "policies"))
	if err != nil {
		t.Fatal(err)
	}
	f := newTwoKeyFixture(t, func(c *config.Config) {
		c.Policies.Dir = policyDir
		c.Policies.Allowed = []string{"agent-strict"}
		// The test covers the allowed list and the root workspace check. The
		// shipped policies hold file and network rules that this fixture runs
		// no backend for, which AEP-CRV-040 refuses without the degraded switch.
		c.Sandbox.AllowDegraded = true
	})
	cases := []struct {
		key, policy string
		want        int
	}{
		{"sk-key-a", "agent-observe", http.StatusForbidden},
		{"sk-key-a", "agent-strict", http.StatusCreated},
		{"sk-key-a", "", http.StatusCreated},
		{"sk-key-a", "default", http.StatusCreated},
		{"sk-key-admin", "agent-observe", http.StatusCreated},
	}
	for _, tc := range cases {
		req := map[string]any{}
		if tc.policy != "" {
			req["policy"] = tc.policy
		}
		if _, rr := f.createSession(t, tc.key, req); rr.Code != tc.want {
			t.Errorf("%s policy %q = %d %s, want %d", tc.key, tc.policy, rr.Code, rr.Body.String(), tc.want)
		}
	}
	for _, key := range []string{"sk-key-a", "sk-key-admin"} {
		if _, rr := f.createSession(t, key, map[string]any{"workspace": "/"}); rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "filesystem root") {
			t.Errorf("%s root workspace = %d %s, want 400", key, rr.Code, rr.Body.String())
		}
	}

	// With auth off there is no role, so the list binds every caller.
	none := newTwoKeyFixture(t, func(c *config.Config) {
		c.Auth.Type = "none"
		c.Policies.Dir = policyDir
	})
	if _, rr := none.createSession(t, "", map[string]any{"policy": "agent-observe"}); rr.Code != http.StatusForbidden {
		t.Errorf("auth none agent-observe = %d %s, want 403", rr.Code, rr.Body.String())
	}
}

// AEP-CRV-030 (CAWB 02): the runtime policy folder that releases ship holds
// no test policy.
func TestRuntimePolicyFolderHoldsNoTestPolicies(t *testing.T) {
	ents, err := os.ReadDir(filepath.Join("..", "..", "configs", "policies"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), "bench-") || strings.Contains(e.Name(), "allow-all") {
			t.Errorf("configs/policies/%s is a test policy in the runtime folder", e.Name())
		}
	}
}
