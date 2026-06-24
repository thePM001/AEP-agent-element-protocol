package api

import (
	"bytes"
	"encoding/base64"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/protocol"
)

func (a *App) operatorIDFromRequest(r *http.Request) string {
	if id, ok := r.Context().Value(ctxKeyOperatorID).(string); ok && id != "" {
		return id
	}
	return ""
}

func (a *App) webauthnRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if a.webauthn == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "webauthn not configured"})
		return
	}
	userID := a.operatorIDFromRequest(r)
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "operator identity required"})
		return
	}
	var req struct {
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
	}
	if ok := decodeJSON(w, r, &req, "invalid json"); !ok {
		return
	}
	if req.Name == "" {
		req.Name = userID
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Name
	}
	options, err := a.webauthn.BeginRegistration(r.Context(), userID, req.Name, req.DisplayName)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, options)
}

func (a *App) webauthnRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if a.webauthn == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "webauthn not configured"})
		return
	}
	userID := a.operatorIDFromRequest(r)
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "operator identity required"})
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "read body failed"})
		return
	}
	parsed, err := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	credName := r.URL.Query().Get("name")
	if credName == "" {
		credName = "security-key"
	}
	displayName := userID
	if err := a.webauthn.FinishRegistration(r.Context(), userID, userID, displayName, credName, parsed); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) webauthnListCredentials(w http.ResponseWriter, r *http.Request) {
	if a.webauthn == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "webauthn not configured"})
		return
	}
	userID := a.operatorIDFromRequest(r)
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "operator identity required"})
		return
	}
	creds, err := a.webauthn.Store().ListCredentials(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	out := make([]map[string]any, 0, len(creds))
	for _, c := range creds {
		out = append(out, map[string]any{
			"id":         c.ID,
			"name":       c.Name,
			"created_at": c.CreatedAt,
			"last_used":  c.LastUsed,
			"credential_id": base64.RawURLEncoding.EncodeToString(c.CredentialID),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *App) webauthnDeleteCredential(w http.ResponseWriter, r *http.Request) {
	if a.webauthn == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "webauthn not configured"})
		return
	}
	userID := a.operatorIDFromRequest(r)
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "operator identity required"})
		return
	}
	rawID := chi.URLParam(r, "id")
	credID, err := base64.RawURLEncoding.DecodeString(rawID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid credential id"})
		return
	}
	if err := a.webauthn.Store().DeleteCredential(r.Context(), userID, credID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *App) approvalWebAuthnChallenge(w http.ResponseWriter, r *http.Request) {
	if a.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"enabled": false, "error": "approvals not enabled"})
		return
	}
	userID := a.operatorIDFromRequest(r)
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "operator identity required"})
		return
	}
	id := chi.URLParam(r, "id")
	challenge, err := a.approvals.GetWebAuthnChallenge(r.Context(), id, userID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, challenge)
}

func (a *App) approvalWebAuthnVerify(w http.ResponseWriter, r *http.Request) {
	if a.approvals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"enabled": false, "error": "approvals not enabled"})
		return
	}
	userID := a.operatorIDFromRequest(r)
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "operator identity required"})
		return
	}
	id := chi.URLParam(r, "id")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "read body failed"})
		return
	}
	if err := a.approvals.ResolveWithWebAuthn(r.Context(), id, userID, body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "decision": "approve"})
}