package api

import (
	"context"
	"errors"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/events"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

// The control API guard (AEP-CRV-030, CAWB 01).
//
// A process that runs inside a session must never change server state: if it
// could create a session, start a command or end one, it would start a process
// that is a child of the server and that the confinement of its own session
// does not reach. The credential alone cannot carry this: auth type none has
// none, and with api_key the wrapped agent holds the agent key in its own
// environment. The guard therefore looks at who is on the other end of the
// connection. For every state changing request it finds the local process that
// owns the client socket and refuses the request when that process belongs to
// a session. The policy network rules deny the server addresses to sessions as
// well (see controlPlaneNetworkRules), so an active enforcement backend stops
// the connection before it reaches the guard.
//
// A peer that is not on this host is not a session process of this server and
// passes to authentication as before. A loopback peer the guard cannot resolve
// is refused: loopback peers are always local, so a failed lookup means the
// guard cannot prove the caller is not a session process.

// controlRuleSessionPeer names the refusal in responses and events.
const controlRuleSessionPeer = "control-api-session-peer"

// errPeerNotLocal reports that the client end of the connection is not a
// socket of this host's network namespace.
var errPeerNotLocal = errors.New("peer is not a local process")

// peerClass is the guard's verdict on the client end of one connection.
type peerClass struct {
	// SessionProcess is true when the owner of the client socket belongs to a
	// session of this server.
	SessionProcess bool
	// PID is the session process that holds the client socket.
	PID int
	// Sessions names the sessions the process belongs to. It is empty when
	// the process is a descendant of the server that no recorded root claims.
	Sessions map[string]struct{}
	// Reason says which marker identified the session process.
	Reason string
}

// peerResolver finds the process that owns the client end of a TCP
// connection and classifies it against the live sessions in view.
type peerResolver interface {
	// classify classifies the client end of a TCP connection. A peer that is
	// not on this host is no session process; a loopback peer that cannot be
	// resolved is an error.
	classify(local, remote net.Addr, view sessionView) (peerClass, error)
	// classifyPID classifies the process that connected over the unix
	// socket listener, as SO_PEERCRED names it.
	classifyPID(pid int, view sessionView) (peerClass, error)
}

// connCtxKey carries the accepted connection in the request context.
type connCtxKey struct{}

// ControlConnContext is the ConnContext of the control API servers. It keeps
// the accepted connection in the request context, so the guard can read the
// peer credentials of a unix socket caller.
func ControlConnContext(ctx context.Context, c net.Conn) context.Context {
	return context.WithValue(ctx, connCtxKey{}, c)
}

// sessionView is the session state the resolver classifies against.
type sessionView struct {
	ServerPID    int
	Roots        map[int]string
	CgroupPrefix map[string]string
	// Prune receives the set of pids that are still used as a pid, process
	// group or session id, so the sessions can drop roots that are gone.
	Prune func(live map[int]struct{})
}

// controlGuard decides control API requests for one App.
type controlGuard struct {
	app      *App
	resolver peerResolver
}

// newPeerResolver builds the resolver of a guard. The package tests replace
// it in TestMain so tests that are not about the guard run as an operator.
var newPeerResolver = defaultPeerResolver

func newControlGuard(a *App) *controlGuard {
	return &controlGuard{app: a, resolver: newPeerResolver()}
}

func (g *controlGuard) view() sessionView {
	v := sessionView{ServerPID: os.Getpid(), Roots: map[int]string{}, CgroupPrefix: map[string]string{}}
	if g.app == nil || g.app.sessions == nil {
		return v
	}
	v.Roots = g.app.sessions.ProcessRoots()
	for _, s := range g.app.sessions.List() {
		v.CgroupPrefix["aep-caw-"+sanitizeCgroupTag(s.ID)+"-"] = s.ID
	}
	sessions := g.app.sessions
	v.Prune = func(live map[int]struct{}) {
		for _, s := range sessions.List() {
			s.PruneProcessRoots(func(pid int) bool {
				_, ok := live[pid]
				return ok
			})
		}
	}
	return v
}

// classifyPeer classifies the client end of a connection given its local and
// remote addresses.
func (g *controlGuard) classifyPeer(local, remote net.Addr) (peerClass, error) {
	return g.resolver.classify(local, remote, g.view())
}

// tcpPeerAddrs checks that a connection is TCP. The control API listens on
// TCP and on the unix socket, which the guard handles apart; anything else is
// a transport the guard does not know, so it is refused.
func tcpPeerAddrs(local, remote net.Addr) (*net.TCPAddr, *net.TCPAddr, error) {
	l, lok := local.(*net.TCPAddr)
	r, rok := remote.(*net.TCPAddr)
	if !lok || !rok || l == nil || r == nil {
		return nil, nil, errors.New("control api peer is not a tcp connection")
	}
	return l, r, nil
}

// remoteIsLoopback reports whether the request came over loopback.
func remoteIsLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// stateChanging reports whether the request can change server state. Every
// write method can, and the PTY route starts a process although it is a GET
// (the websocket upgrade). Two POST routes only evaluate a policy and change
// nothing, so a session process may still ask them.
func stateChanging(r *http.Request) bool {
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return isPTYPath(path)
	case http.MethodPost:
		return path != "/api/v1/policy/test" && path != "/api/v1/policies/validate"
	default:
		return true
	}
}

func isPTYPath(path string) bool {
	rest, ok := strings.CutPrefix(path, "/api/v1/sessions/")
	if !ok {
		return false
	}
	id, tail, ok := strings.Cut(rest, "/")
	return ok && id != "" && tail == "pty"
}

// wrapInitTarget returns the session id of a wrap-init request.
func wrapInitTarget(r *http.Request) (string, bool) {
	if r.Method != http.MethodPost {
		return "", false
	}
	rest, ok := strings.CutPrefix(strings.TrimSuffix(r.URL.Path, "/"), "/api/v1/sessions/")
	if !ok {
		return "", false
	}
	id, tail, ok := strings.Cut(rest, "/")
	if !ok || id == "" || tail != "wrap-init" {
		return "", false
	}
	return id, true
}

// requiresJSONBody reports whether the request must carry a JSON body. A
// browser can send a cross origin POST without a preflight only as a form or
// as text/plain, so a JSON content type on every write keeps a web page in the
// operator's browser from reaching the API.
func requiresJSONBody(r *http.Request) bool {
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return true
	}
	return false
}

func isJSONContentType(v string) bool {
	if strings.TrimSpace(v) == "" {
		return false
	}
	mt, _, err := mime.ParseMediaType(v)
	if err != nil {
		return false
	}
	return mt == "application/json" || (strings.HasPrefix(mt, "application/") && strings.HasSuffix(mt, "+json"))
}

// isLoopbackHost reports whether the Host header names this machine by a
// loopback name. With auth disabled the server only listens on loopback, so a
// different Host means a browser was pointed here by DNS rebinding.
func isLoopbackHost(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (a *App) authDisabled() bool {
	return a.cfg == nil || a.cfg.Development.DisableAuth || strings.EqualFold(strings.TrimSpace(a.cfg.Auth.Type), "none")
}

// controlGuardMiddleware runs before authentication on every HTTP request.
func (a *App) controlGuardMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g := a.controlGuard()
		// A loopback caller that names another host is a browser that DNS
		// rebinding pointed here. With auth disabled the server listens on
		// loopback only, so every caller there is a loopback caller.
		if a.authDisabled() && remoteIsLoopback(r.RemoteAddr) && !isLoopbackHost(r.Host) {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error": "host not allowed: with auth disabled the API answers only to a loopback host name",
			})
			return
		}
		if !stateChanging(r) {
			next.ServeHTTP(w, r)
			return
		}
		if requiresJSONBody(r) && !isJSONContentType(r.Header.Get("Content-Type")) {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "content type must be application/json"})
			return
		}
		target, isWrapInit := wrapInitTarget(r)
		call := r.Method + " " + r.URL.Path
		var refusal string
		if uc, ok := r.Context().Value(connCtxKey{}).(*net.UnixConn); ok {
			refusal = g.decideResult(r.Context(), call, target, isWrapInit, func() (peerClass, error) {
				return g.resolver.classifyPID(getConnPeerCreds(uc).PID, g.view())
			})
		} else {
			local, _ := r.Context().Value(http.LocalAddrContextKey).(net.Addr)
			var remoteAddr net.Addr
			if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
				remoteAddr = net.TCPAddrFromAddrPort(ap)
			}
			refusal = g.decide(r.Context(), local, remoteAddr, call, target, isWrapInit)
		}
		if refusal != "" {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": refusal, "rule": controlRuleSessionPeer})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// decide returns an empty string when the peer may make the call and the
// refusal message otherwise. A session process may ask for wrap-init on its
// own session, because that only stacks more confinement on its own process
// tree (the shell entry kernel install inside a session does this).
func (g *controlGuard) decide(ctx context.Context, local, remote net.Addr, call string, wrapTarget string, isWrapInit bool) string {
	return g.decideResult(ctx, call, wrapTarget, isWrapInit, func() (peerClass, error) {
		return g.classifyPeer(local, remote)
	})
}

// decideResult applies the guard to the verdict that classify returns.
func (g *controlGuard) decideResult(ctx context.Context, call string, wrapTarget string, isWrapInit bool, classify func() (peerClass, error)) string {
	pc, err := classify()
	if err != nil {
		slog.Warn("control api: refusing a peer the guard cannot resolve", "call", call, "error", err)
		g.emitRefusal(ctx, "", pc, call, err.Error())
		return "control api refused: the caller could not be checked against the session processes"
	}
	if !pc.SessionProcess {
		return ""
	}
	if isWrapInit {
		if _, own := pc.Sessions[wrapTarget]; own && len(pc.Sessions) == 1 {
			return ""
		}
	}
	slog.Warn("control api: refused a session process", "call", call, "pid", pc.PID, "reason", pc.Reason)
	sid := ""
	for id := range pc.Sessions {
		sid = id
		break
	}
	g.emitRefusal(ctx, sid, pc, call, pc.Reason)
	return "control api refused: a session process may not change server state"
}

func (g *controlGuard) emitRefusal(ctx context.Context, sessionID string, pc peerClass, call, reason string) {
	if g.app == nil || g.app.store == nil {
		return
	}
	ev := types.Event{
		ID:              uuid.NewString(),
		Timestamp:       time.Now().UTC(),
		Type:            string(events.EventControlAPIPeerRefused),
		SessionID:       sessionID,
		Source:          "aep-caw",
		EffectiveAction: "deny",
		Fields: map[string]any{
			"rule":   controlRuleSessionPeer,
			"call":   call,
			"pid":    pc.PID,
			"reason": reason,
		},
	}
	_ = g.app.store.AppendEvent(context.WithoutCancel(ctx), ev)
	if g.app.broker != nil {
		g.app.broker.Publish(ev)
	}
}

// grpcStateChanging lists the gRPC methods that change server state.
var grpcStateChanging = map[string]bool{
	"CreateSession":   true,
	"Exec":            true,
	"ExecStream":      true,
	"ExecPTY":         true,
	"DestroySession":  true,
	"PatchSession":    true,
	"KillCommand":     true,
	"ResolveApproval": true,
}

func grpcMethodName(full string) string {
	if i := strings.LastIndex(full, "/"); i >= 0 {
		return full[i+1:]
	}
	return full
}

// grpcGuard applies the control guard to one gRPC call.
func (a *App) grpcGuard(ctx context.Context, fullMethod string) error {
	if !grpcStateChanging[grpcMethodName(fullMethod)] {
		return nil
	}
	p, ok := peer.FromContext(ctx)
	if !ok || p == nil {
		return status.Error(codes.PermissionDenied, "control api refused: no peer on the call")
	}
	if refusal := a.controlGuard().decide(ctx, p.LocalAddr, p.Addr, fullMethod, "", false); refusal != "" {
		return status.Error(codes.PermissionDenied, refusal)
	}
	return nil
}

// GRPCControlGuardUnaryInterceptor refuses state changing unary calls from
// session processes. It runs before the auth interceptor.
func GRPCControlGuardUnaryInterceptor(app *App) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if err := app.grpcGuard(ctx, info.FullMethod); err != nil {
			return nil, err
		}
		return handler(ctx, req)
	}
}

// GRPCControlGuardStreamInterceptor refuses state changing streamed calls from
// session processes. It runs before the auth interceptor.
func GRPCControlGuardStreamInterceptor(app *App) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if err := app.grpcGuard(ss.Context(), info.FullMethod); err != nil {
			return err
		}
		return handler(srv, ss)
	}
}

// controlGuard returns the guard of this App. Tests set a.peerResolver to
// classify synthetic peers; production uses the host resolver.
func (a *App) controlGuard() *controlGuard {
	g := newControlGuard(a)
	if a.peerResolver != nil {
		g.resolver = a.peerResolver
	}
	return g
}
