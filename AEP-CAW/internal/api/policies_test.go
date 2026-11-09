package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/config"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/events"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/session"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/internal/store/composite"
	"github.com/thePM001/AEP-agent-element-protocol/AEP-CAW/pkg/types"
)

// mockEventStore is a minimal event store for testing
type mockEventStore struct{}

func (mockEventStore) AppendEvent(ctx context.Context, ev types.Event) error { return nil }
func (mockEventStore) QueryEvents(ctx context.Context, q types.EventQuery) ([]types.Event, error) {
	return nil, nil
}
func (mockEventStore) Close() error { return nil }

func newTestAppForPolicies(t *testing.T) *App {
	cfg := &config.Config{}
	mgr := session.NewManager(5)
	store := composite.New(mockEventStore{}, nil)
	broker := events.NewBroker()
	return NewApp(cfg, mgr, store, nil, broker, nil, nil, nil, nil, nil, nil, nil)
}

func TestValidatePolicyRules(t *testing.T) {
	tests := []struct {
		name       string
		policyType string
		rules      []PolicyRule
		wantValid  bool
		wantErrs   int
	}{
		{
			name:       "valid file policy",
			policyType: "file",
			rules: []PolicyRule{
				{Name: "allow-workspace", Paths: []string{"/workspace/**"}, Action: "allow"},
			},
			wantValid: true,
			wantErrs:  0,
		},
		{
			name:       "valid network policy",
			policyType: "network",
			rules: []PolicyRule{
				{Name: "allow-https", Ports: []int{443}, Action: "allow"},
				{Name: "deny-http", Ports: []int{80}, Action: "deny"},
			},
			wantValid: true,
			wantErrs:  0,
		},
		{
			name:       "valid command policy",
			policyType: "command",
			rules: []PolicyRule{
				{Name: "allow-git", Commands: []string{"git"}, Action: "allow"},
			},
			wantValid: true,
			wantErrs:  0,
		},
		{
			name:       "invalid policy type",
			policyType: "invalid",
			rules: []PolicyRule{
				{Name: "test", Action: "allow"},
			},
			wantValid: false,
			wantErrs:  1,
		},
		{
			name:       "missing rule name",
			policyType: "file",
			rules: []PolicyRule{
				{Paths: []string{"/tmp"}, Action: "allow"},
			},
			wantValid: false,
			wantErrs:  1,
		},
		{
			name:       "invalid action",
			policyType: "file",
			rules: []PolicyRule{
				{Name: "test", Paths: []string{"/tmp"}, Action: "invalid"},
			},
			wantValid: false,
			wantErrs:  1,
		},
		{
			name:       "approve action without timeout warning",
			policyType: "file",
			rules: []PolicyRule{
				{Name: "approve-sensitive", Paths: []string{"/etc/**"}, Action: "approve"},
			},
			wantValid: true,
			wantErrs:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := validatePolicyRules(tt.policyType, tt.rules)
			if result.Valid != tt.wantValid {
				t.Errorf("Valid = %v, want %v", result.Valid, tt.wantValid)
			}
			if len(result.Errors) != tt.wantErrs {
				t.Errorf("len(Errors) = %d, want %d: %+v", len(result.Errors), tt.wantErrs, result.Errors)
			}
		})
	}
}

func TestValidatePolicyRules_Warnings(t *testing.T) {
	tests := []struct {
		name         string
		policyType   string
		rules        []PolicyRule
		wantWarnings int
	}{
		{
			name:       "file policy without paths",
			policyType: "file",
			rules: []PolicyRule{
				{Name: "empty", Action: "allow"},
			},
			wantWarnings: 1,
		},
		{
			name:       "network policy without domains or ports",
			policyType: "network",
			rules: []PolicyRule{
				{Name: "empty", Action: "allow"},
			},
			wantWarnings: 1,
		},
		{
			name:       "command policy without commands",
			policyType: "command",
			rules: []PolicyRule{
				{Name: "empty", Action: "allow"},
			},
			wantWarnings: 1,
		},
		{
			name:       "approve without timeout",
			policyType: "file",
			rules: []PolicyRule{
				{Name: "approve-test", Paths: []string{"/tmp"}, Action: "approve"},
			},
			wantWarnings: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := validatePolicyRules(tt.policyType, tt.rules)
			if len(result.Warning) != tt.wantWarnings {
				t.Errorf("len(Warnings) = %d, want %d: %v", len(result.Warning), tt.wantWarnings, result.Warning)
			}
		})
	}
}

func TestPolicyStore_CRUD(t *testing.T) {
	// Reset store for test isolation
	<-policyStoreMu
	policyStore = make(map[string]PolicyInfo)
	policyStoreMu <- struct{}{}

	app := newTestAppForPolicies(t)

	// Create policy
	policy := PolicyInfo{
		ID:   "policy-test1",
		Name: "Test Policy",
		Type: "file",
		Rules: []PolicyRule{
			{Name: "allow-all", Paths: []string{"/**"}, Action: "allow"},
		},
	}
	app.storePolicyInfo(policy)

	// Get policy
	got := app.findPolicyByID("policy-test1")
	if got == nil {
		t.Fatal("findPolicyByID returned nil")
	}
	if got.Name != policy.Name {
		t.Errorf("Name = %s, want %s", got.Name, policy.Name)
	}

	// List policies
	list := app.getPoliciesFromEngine()
	if len(list) != 1 {
		t.Errorf("len(list) = %d, want 1", len(list))
	}

	// Update policy
	policy.Name = "Updated Policy"
	app.storePolicyInfo(policy)
	got = app.findPolicyByID("policy-test1")
	if got.Name != "Updated Policy" {
		t.Errorf("Name after update = %s, want Updated Policy", got.Name)
	}

	// Delete policy
	if !app.removePolicyByID("policy-test1") {
		t.Error("removePolicyByID returned false")
	}
	if app.findPolicyByID("policy-test1") != nil {
		t.Error("policy should be nil after delete")
	}

	// Delete non-existent
	if app.removePolicyByID("policy-nonexistent") {
		t.Error("removePolicyByID should return false for non-existent")
	}
}

func TestPolicyAPI_CreatePolicy(t *testing.T) {
	// Reset store
	<-policyStoreMu
	policyStore = make(map[string]PolicyInfo)
	policyStoreMu <- struct{}{}

	app := newTestAppForPolicies(t)
	r := chi.NewRouter()
	r.Post("/policies", app.createPolicy)

	// Policy writes through the API never change enforcement: policies are edited
	// on disk and reloaded, so create answers 501 for every body and stores nothing.
	bodies := map[string]CreatePolicyRequest{
		"valid_policy": {
			Name:  "Test Policy",
			Type:  "file",
			Rules: []PolicyRule{{Name: "allow-tmp", Paths: []string{"/tmp"}, Action: "allow"}},
		},
		"missing_name": {Type: "file"},
		"missing_type": {Name: "Test"},
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(body)
			req := httptest.NewRequest(http.MethodPost, "/policies", bytes.NewReader(raw))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusNotImplemented {
				t.Errorf("status = %d, want %d: %s", w.Code, http.StatusNotImplemented, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "edit on-disk policies and reload") {
				t.Errorf("body should point to on-disk edits: %s", w.Body.String())
			}
		})
	}
	<-policyStoreMu
	n := len(policyStore)
	policyStoreMu <- struct{}{}
	if n != 0 {
		t.Errorf("create stored %d policies, want 0", n)
	}
}

func TestPolicyAPI_GetPolicy(t *testing.T) {
	// Reset store
	<-policyStoreMu
	policyStore = make(map[string]PolicyInfo)
	policyStoreMu <- struct{}{}

	app := newTestAppForPolicies(t)
	app.storePolicyInfo(PolicyInfo{
		ID:   "policy-123",
		Name: "Test Policy",
		Type: "file",
	})

	r := chi.NewRouter()
	r.Get("/policies/{policyId}", app.getPolicy)

	tests := []struct {
		name       string
		policyID   string
		wantStatus int
	}{
		{
			name:       "existing policy",
			policyID:   "policy-123",
			wantStatus: http.StatusOK,
		},
		{
			name:       "non-existent policy",
			policyID:   "policy-999",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/policies/"+tt.policyID, nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}

func TestPolicyAPI_UpdatePolicy(t *testing.T) {
	// Reset store
	<-policyStoreMu
	policyStore = make(map[string]PolicyInfo)
	policyStoreMu <- struct{}{}

	app := newTestAppForPolicies(t)
	app.storePolicyInfo(PolicyInfo{
		ID:   "policy-123",
		Name: "Original Name",
		Type: "file",
		Rules: []PolicyRule{
			{Name: "rule1", Paths: []string{"/tmp"}, Action: "allow"},
		},
	})

	r := chi.NewRouter()
	r.Put("/policies/{policyId}", app.updatePolicy)

	body, _ := json.Marshal(UpdatePolicyRequest{Name: "Updated Name"})
	req := httptest.NewRequest(http.MethodPut, "/policies/policy-123", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Update is fail closed: 501 and the stored policy is unchanged.
	if w.Code != http.StatusNotImplemented {
		t.Errorf("status = %d, want %d: %s", w.Code, http.StatusNotImplemented, w.Body.String())
	}
	got := app.findPolicyByID("policy-123")
	if got == nil || got.Name != "Original Name" {
		t.Errorf("policy changed by update: %+v", got)
	}
}

func TestPolicyAPI_DeletePolicy(t *testing.T) {
	// Reset store
	<-policyStoreMu
	policyStore = make(map[string]PolicyInfo)
	policyStoreMu <- struct{}{}

	app := newTestAppForPolicies(t)
	app.storePolicyInfo(PolicyInfo{
		ID:   "policy-123",
		Name: "Test Policy",
		Type: "file",
	})

	r := chi.NewRouter()
	r.Delete("/policies/{policyId}", app.deletePolicy)

	req := httptest.NewRequest(http.MethodDelete, "/policies/policy-123", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Delete is fail closed: 501 and the policy is still there.
	if w.Code != http.StatusNotImplemented {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNotImplemented)
	}
	if app.findPolicyByID("policy-123") == nil {
		t.Errorf("policy removed by delete")
	}
}

func TestPolicyAPI_ValidatePolicy(t *testing.T) {
	app := newTestAppForPolicies(t)
	r := chi.NewRouter()
	r.Post("/policies/validate", app.validatePolicy)

	tests := []struct {
		name      string
		body      CreatePolicyRequest
		wantValid bool
	}{
		{
			name: "valid policy",
			body: CreatePolicyRequest{
				Name: "Test",
				Type: "file",
				Rules: []PolicyRule{
					{Name: "rule1", Paths: []string{"/tmp"}, Action: "allow"},
				},
			},
			wantValid: true,
		},
		{
			name: "invalid policy",
			body: CreatePolicyRequest{
				Name: "Test",
				Type: "invalid",
				Rules: []PolicyRule{
					{Name: "rule1", Action: "allow"},
				},
			},
			wantValid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.body)
			req := httptest.NewRequest(http.MethodPost, "/policies/validate", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
			}

			var result PolicyValidationResult
			if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
				t.Fatalf("decode response: %v", err)
			}

			if result.Valid != tt.wantValid {
				t.Errorf("Valid = %v, want %v", result.Valid, tt.wantValid)
			}
		})
	}
}
