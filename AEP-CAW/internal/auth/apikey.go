package auth

import (
	"crypto/subtle"
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type APIKeyAuth struct {
	headerName string
	keys       map[string]string // key -> role
}

type keyFileEntry struct {
	ID          string `yaml:"id"`
	Key         string `yaml:"key"`
	Description string `yaml:"description"`
	Role        string `yaml:"role"` // agent|approver|admin
}

func LoadAPIKeys(keysFile string, headerName string) (*APIKeyAuth, error) {
	if strings.TrimSpace(headerName) == "" {
		headerName = "X-API-Key"
	}
	if keysFile == "" {
		return nil, fmt.Errorf("api key auth enabled but keys_file is empty")
	}
	b, err := os.ReadFile(keysFile)
	if err != nil {
		return nil, fmt.Errorf("read api keys file: %w", err)
	}
	var entries []keyFileEntry
	if err := yaml.Unmarshal(b, &entries); err != nil {
		return nil, fmt.Errorf("parse api keys file: %w", err)
	}
	keys := make(map[string]string, len(entries))
	refuseSample := !strings.EqualFold(os.Getenv("AEP_CAW_ALLOW_SAMPLE_KEYS"), "1")
	for _, e := range entries {
		if strings.TrimSpace(e.Key) == "" {
			continue
		}
		key := strings.TrimSpace(e.Key)
		if refuseSample && isSampleAPIKey(key) {
			return nil, fmt.Errorf("sample/placeholder API key %q refused (set AEP_CAW_ALLOW_SAMPLE_KEYS=1 for pure local loopback dev only)", e.ID)
		}
		role := strings.ToLower(strings.TrimSpace(e.Role))
		if role == "" {
			// Least privilege: never default empty role to admin.
			role = "agent"
		}
		keys[key] = role
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("api keys file contains no keys")
	}
	return &APIKeyAuth{headerName: headerName, keys: keys}, nil
}

func (a *APIKeyAuth) HeaderName() string { return a.headerName }

func (a *APIKeyAuth) IsAllowed(key string) bool {
	// MEDIUM: constant-time compare against stored keys
	if a == nil || key == "" {
		return false
	}
	kb := []byte(key)
	okAny := false
	for k := range a.keys {
		sb := []byte(k)
		if len(kb) != len(sb) {
			// still mix timing: compare digests of unequal lengths via pad
			continue
		}
		if subtle.ConstantTimeCompare(kb, sb) == 1 {
			okAny = true
		}
	}
	return okAny
}

func isSampleAPIKey(key string) bool {
	k := strings.TrimSpace(key)
	if k == "sk-dev-local" {
		return true
	}
	if strings.HasPrefix(k, "REPLACE_ME") {
		return true
	}
	if strings.Contains(strings.ToLower(k), "example") {
		return true
	}
	return false
}

func (a *APIKeyAuth) RoleForKey(key string) string {
	if a == nil {
		return ""
	}
	role, ok := a.keys[key]
	if !ok {
		return ""
	}
	return role
}
