package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/kerneldock"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// silentDockFixture is a kernel dock fixture whose socket base holds no dock.
func silentDockFixture(t *testing.T) *kernelDockFixture {
	t.Helper()
	socketBase := filepath.Join(t.TempDir(), "sockets")
	if err := os.MkdirAll(socketBase, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	return newKernelDockFixture(t, true, socketBase)
}

// AEP-CRV-030 (CAWA 02): wrap-init hands out the wrapper that starts the
// agent, so it refuses while the kernel dock is silent.
func TestWrapInitRefusesWhenKernelDockIsSilent(t *testing.T) {
	f := silentDockFixture(t)
	_, code, err := f.app.wrapInitCore(f.session, f.session.ID, types.WrapInitRequest{AgentCommand: f.cmdPath})
	if code != http.StatusServiceUnavailable {
		t.Fatalf("wrap-init status = %d, want %d (err %v)", code, http.StatusServiceUnavailable, err)
	}
	assertRefused(t, err, filepath.Join(f.socketBase, "validation"))
	if n := len(f.refusalEvents()); n != 1 {
		t.Fatalf("refusal events = %d, want 1", n)
	}
}

// AEP-CRV-030 (CAWA 02): the gRPC streamed exec refuses while the kernel
// dock is silent, before the policy precheck and before any process starts.
func TestGRPCExecStreamRefusesWhenKernelDockIsSilent(t *testing.T) {
	f := silentDockFixture(t)
	in, err := structpb.NewStruct(map[string]any{"session_id": f.session.ID, "command": f.cmdPath})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err = (&grpcServer{app: f.app}).ExecStream(in, &captureServerStream{ctx: ctx})
	if status.Code(err) != codes.Unavailable || !strings.Contains(err.Error(), kerneldock.Rule) {
		t.Fatalf("ExecStream error = %v, want Unavailable with the named refusal", err)
	}
	if n := len(f.refusalEvents()); n != 1 {
		t.Fatalf("refusal events = %d, want 1", n)
	}
	if len(f.precheckEvents()) != 0 {
		t.Fatal("the precheck ran, so the dock gate sits after it")
	}
}

// processStartRoutes lists every HTTP route that starts a process, with the
// test that proves it refuses on a silent dock.
var processStartRoutes = map[string]string{
	"POST /api/v1/sessions/{id}/exec":        "TestExecInSessionCoreRefusesWhenKernelDockIsSilent",
	"POST /api/v1/sessions/{id}/exec/stream": "TestExecInSessionStreamRefusesWhenKernelDockIsSilent",
	"GET /api/v1/sessions/{id}/pty":          "TestStartPTYRefusesWhenKernelDockIsSilent",
	"POST /api/v1/sessions/{id}/wrap-init":   "TestWrapInitRefusesWhenKernelDockIsSilent",
}

// processStartGRPC lists every gRPC method that starts a process. Exec runs
// through execInSessionCore and ExecPTY through startPTY, the same cores as
// the HTTP exec and PTY routes.
var processStartGRPC = map[string]string{
	"Exec":       "TestExecInSessionCoreRefusesWhenKernelDockIsSilent",
	"ExecStream": "TestGRPCExecStreamRefusesWhenKernelDockIsSilent",
	"ExecPTY":    "TestStartPTYRefusesWhenKernelDockIsSilent",
}

// noProcessRoutes lists every HTTP route that starts no process.
var noProcessRoutes = map[string]bool{
	"GET /debug/ebpf":                               true,
	"GET /health":                                   true,
	"GET /ready":                                    true,
	"POST /auth/webauthn/register/begin":            true,
	"POST /auth/webauthn/register/finish":           true,
	"GET /auth/webauthn/credentials":                true,
	"DELETE /auth/webauthn/credentials/{id}":        true,
	"GET /api/v1/profiles":                          true,
	"POST /api/v1/sessions":                         true,
	"GET /api/v1/sessions":                          true,
	"GET /api/v1/sessions/{id}":                     true,
	"PATCH /api/v1/sessions/{id}":                   true,
	"DELETE /api/v1/sessions/{id}":                  true,
	"GET /api/v1/sessions/{id}/events":              true,
	"GET /api/v1/sessions/{id}/history":             true,
	"GET /api/v1/sessions/{id}/proxy":               true,
	"GET /api/v1/sessions/{id}/output/{cmdID}":      true,
	"POST /api/v1/sessions/{id}/kill/{cmdID}":       true,
	"PUT /api/v1/sessions/{id}/trace-context":       true,
	"GET /api/v1/events/search":                     true,
	"GET /api/v1/approvals":                         true,
	"GET /api/v1/approvals/{id}/webauthn/challenge": true,
	"POST /api/v1/approvals/{id}/webauthn":          true,
	"POST /api/v1/approvals/{id}":                   true,
	"GET /api/v1/policies":                          true,
	"POST /api/v1/policies":                         true,
	"GET /api/v1/policies/{policyId}":               true,
	"PUT /api/v1/policies/{policyId}":               true,
	"DELETE /api/v1/policies/{policyId}":            true,
	"POST /api/v1/policies/validate":                true,
	"POST /api/v1/policy/test":                      true,
	"GET /api/v1/mcp/tools":                         true,
	"GET /api/v1/mcp/servers":                       true,
}

// AEP-CRV-030 (CAWA 02): every route and gRPC method is classified, and each
// one that starts a process names the test that proves the dock gate. A new
// route fails this test until someone decides which list it belongs to.
func TestEveryProcessStartRouteChecksKernelDock(t *testing.T) {
	f := silentDockFixture(t)
	f.app.cfg.Health.Path = "/health"
	f.app.cfg.Health.ReadinessPath = "/ready"
	router, ok := f.app.Router().(chi.Routes)
	if !ok {
		t.Fatal("Router is not a chi router")
	}
	var unclassified []string
	err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		key := method + " " + strings.TrimSuffix(strings.ReplaceAll(route, "/*/", "/"), "/")
		if _, ok := processStartRoutes[key]; ok {
			return nil
		}
		if !noProcessRoutes[key] {
			unclassified = append(unclassified, key)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk routes: %v", err)
	}
	sort.Strings(unclassified)
	if len(unclassified) > 0 {
		t.Fatalf("routes missing from processStartRoutes or noProcessRoutes: %v", unclassified)
	}

	grpcSrv := grpc.NewServer()
	RegisterGRPC(grpcSrv, f.app)
	noProcessGRPC := map[string]bool{
		"CreateSession": true, "ListSessions": true, "GetSession": true, "DestroySession": true,
		"PatchSession": true, "KillCommand": true, "QueryEvents": true, "SearchEvents": true,
		"OutputChunk": true, "ListApprovals": true, "ResolveApproval": true, "PolicyTest": true,
		"EventsTail": true,
	}
	for _, info := range grpcSrv.GetServiceInfo() {
		for _, m := range info.Methods {
			if _, ok := processStartGRPC[m.Name]; ok {
				continue
			}
			if !noProcessGRPC[m.Name] {
				t.Errorf("gRPC method %s is missing from processStartGRPC or noProcessGRPC", m.Name)
			}
		}
	}

	for route, test := range processStartRoutes {
		if !testExists(t, test) {
			t.Errorf("route %s names %s, which does not exist", route, test)
		}
	}
	for method, test := range processStartGRPC {
		if !testExists(t, test) {
			t.Errorf("gRPC method %s names %s, which does not exist", method, test)
		}
	}
}

// testExists reports whether a test of that name is declared in this package.
func testExists(t *testing.T, name string) bool {
	t.Helper()
	files, err := filepath.Glob("*_test.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "func "+name+"(t *testing.T)") {
			return true
		}
	}
	return false
}
