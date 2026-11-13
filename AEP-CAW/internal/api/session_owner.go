package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/session"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Session ownership (AEP-CRV-030, CAWB 03). Every route and gRPC method that
// names a session goes through ownedSession, so a key reads, streams and ends
// only the sessions it created. The admin role and auth type none (one tenant)
// keep access to every session, as canAccessSessionCtx defines.

const errSessionAccessDenied = "session access denied (operator ownership)"

// ownedSession returns the session when it exists and the caller may use it.
// The status is 404 for an unknown session and 403 for a session of another
// operator.
func (a *App) ownedSession(ctx context.Context, id string) (*session.Session, int, string) {
	s, ok := a.sessions.Get(strings.TrimSpace(id))
	if !ok {
		return nil, http.StatusNotFound, "session not found"
	}
	if !a.canAccessSessionCtx(ctx, s) {
		return nil, http.StatusForbidden, errSessionAccessDenied
	}
	return s, http.StatusOK, ""
}

// ownedSessionHTTP writes the refusal and returns false when the caller may
// not use the session.
func (a *App) ownedSessionHTTP(w http.ResponseWriter, r *http.Request, id string) (*session.Session, bool) {
	s, code, msg := a.ownedSession(r.Context(), id)
	if s == nil {
		writeJSON(w, code, map[string]any{"error": msg})
		return nil, false
	}
	return s, true
}

// ownedSessionGRPC is ownedSession with gRPC status codes.
func (a *App) ownedSessionGRPC(ctx context.Context, id string) (*session.Session, error) {
	s, code, msg := a.ownedSession(ctx, id)
	if s == nil {
		if code == http.StatusNotFound {
			return nil, status.Error(codes.NotFound, msg)
		}
		return nil, status.Error(codes.PermissionDenied, msg)
	}
	return s, nil
}

// ownershipLimited reports whether the caller sees only its own sessions.
func (a *App) ownershipLimited(ctx context.Context) bool {
	if a.authDisabled() {
		return false
	}
	role, _ := ctx.Value(ctxKeyRole).(string)
	return !strings.EqualFold(role, "admin")
}

// commandInSession reports whether cmdID ran in sessionID. Output is stored
// by command id alone, so without this check a key that owns one session
// could read the output of a command of another session through its own
// session's route. Callers that see every session skip the lookup.
func (a *App) commandInSession(ctx context.Context, sessionID, cmdID string) bool {
	if !a.ownershipLimited(ctx) {
		return true
	}
	if a.store == nil || strings.TrimSpace(cmdID) == "" {
		return false
	}
	evs, err := a.store.QueryEvents(ctx, types.EventQuery{SessionID: sessionID, CommandID: cmdID, Limit: 1})
	return err == nil && len(evs) > 0
}

// ownedEvents keeps the events of sessions the caller may use. Events of a
// session that no longer exists have no owner left to check and are kept
// only for callers that see every session.
func (a *App) ownedEvents(ctx context.Context, evs []types.Event) []types.Event {
	if !a.ownershipLimited(ctx) {
		return evs
	}
	out := make([]types.Event, 0, len(evs))
	allowed := map[string]bool{}
	for _, ev := range evs {
		ok, seen := allowed[ev.SessionID]
		if !seen {
			s, _, _ := a.ownedSession(ctx, ev.SessionID)
			ok = s != nil
			allowed[ev.SessionID] = ok
		}
		if ok {
			out = append(out, ev)
		}
	}
	return out
}
