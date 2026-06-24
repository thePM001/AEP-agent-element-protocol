package auth

import (
	"strings"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
)

func TestNewWebAuthnService(t *testing.T) {
	db := setupTestDB(t)
	store := NewWebAuthnStore(db)

	tests := []struct {
		name             string
		rpID             string
		rpName           string
		rpOrigins        []string
		userVerification string
		wantErr          bool
		errContains      string
	}{
		{
			name:             "valid configuration",
			rpID:             "aep-caw.local",
			rpName:           "aep-caw",
			rpOrigins:        []string{"http://localhost:18080"},
			userVerification: "preferred",
			wantErr:          false,
		},
		{
			name:             "valid with multiple origins",
			rpID:             "aep-caw.local",
			rpName:           "aep-caw",
			rpOrigins:        []string{"http://localhost:18080", "https://aep-caw.local"},
			userVerification: "preferred",
			wantErr:          false,
		},
		{
			name:             "empty rpID",
			rpID:             "",
			rpName:           "aep-caw",
			rpOrigins:        []string{"http://localhost:18080"},
			userVerification: "preferred",
			wantErr:          true,
			errContains:      "rpID is required",
		},
		{
			name:             "empty rpName",
			rpID:             "aep-caw.local",
			rpName:           "",
			rpOrigins:        []string{"http://localhost:18080"},
			userVerification: "preferred",
			wantErr:          true,
			errContains:      "rpName is required",
		},
		{
			name:             "empty origins",
			rpID:             "aep-caw.local",
			rpName:           "aep-caw",
			rpOrigins:        []string{},
			userVerification: "preferred",
			wantErr:          true,
			errContains:      "at least one rpOrigin is required",
		},
		{
			name:             "nil origins",
			rpID:             "aep-caw.local",
			rpName:           "aep-caw",
			rpOrigins:        nil,
			userVerification: "preferred",
			wantErr:          true,
			errContains:      "at least one rpOrigin is required",
		},
		{
			name:             "invalid user verification",
			rpID:             "aep-caw.local",
			rpName:           "aep-caw",
			rpOrigins:        []string{"http://localhost:18080"},
			userVerification: "invalid_mode",
			wantErr:          true,
			errContains:      "invalid user verification mode",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, err := NewWebAuthnService(tt.rpID, tt.rpName, tt.rpOrigins, tt.userVerification, store)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errContains)
					return
				}
				if tt.errContains != "" && !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("error %q should contain %q", err.Error(), tt.errContains)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if svc == nil {
				t.Error("expected non-nil service")
				return
			}

			if svc.wa == nil {
				t.Error("expected non-nil webauthn instance")
			}

			if svc.store == nil {
				t.Error("expected non-nil store")
			}

			if svc.sessions == nil {
				t.Error("expected non-nil sessions map")
			}
		})
	}
}

func TestWebAuthnService_UserVerificationModes(t *testing.T) {
	db := setupTestDB(t)
	store := NewWebAuthnStore(db)

	tests := []struct {
		name             string
		userVerification string
		wantMode         protocol.UserVerificationRequirement
		wantErr          bool
	}{
		{
			name:             "preferred mode",
			userVerification: "preferred",
			wantMode:         protocol.VerificationPreferred,
			wantErr:          false,
		},
		{
			name:             "required mode",
			userVerification: "required",
			wantMode:         protocol.VerificationRequired,
			wantErr:          false,
		},
		{
			name:             "discouraged mode",
			userVerification: "discouraged",
			wantMode:         protocol.VerificationDiscouraged,
			wantErr:          false,
		},
		{
			name:             "empty defaults to preferred",
			userVerification: "",
			wantMode:         protocol.VerificationPreferred,
			wantErr:          false,
		},
		{
			name:             "invalid mode",
			userVerification: "unknown",
			wantErr:          true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, err := NewWebAuthnService(
				"aep-caw.local",
				"aep-caw",
				[]string{"http://localhost:18080"},
				tt.userVerification,
				store,
			)

			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if svc == nil {
				t.Error("expected non-nil service")
			}
		})
	}
}

func TestWebAuthnUser_Interface(t *testing.T) {
	id := "user-123"
	name := "testuser"
	displayName := "Test User"

	user := NewWebAuthnUser(id, name, displayName, nil)

	if string(user.WebAuthnID()) != id {
		t.Errorf("WebAuthnID: got %q, want %q", string(user.WebAuthnID()), id)
	}

	if user.WebAuthnName() != name {
		t.Errorf("WebAuthnName: got %q, want %q", user.WebAuthnName(), name)
	}

	if user.WebAuthnDisplayName() != displayName {
		t.Errorf("WebAuthnDisplayName: got %q, want %q", user.WebAuthnDisplayName(), displayName)
	}

	if user.WebAuthnCredentials() != nil {
		t.Errorf("WebAuthnCredentials: expected nil, got %v", user.WebAuthnCredentials())
	}
}
