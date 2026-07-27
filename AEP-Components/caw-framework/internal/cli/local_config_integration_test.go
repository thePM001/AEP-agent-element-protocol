//go:build integration

package cli

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nla-aep/aep-caw-framework/internal/config"
)

func TestUserLocalConfigIntegration(t *testing.T) {
	// Create temp directories for user and system config
	tmpDir := t.TempDir()

	// Create user config
	userConfigDir := filepath.Join(tmpDir, "user", ".config", "aep-caw")
	os.MkdirAll(userConfigDir, 0755)
	userConfigFile := filepath.Join(userConfigDir, "config.yaml")
	userPoliciesDir := filepath.Join(userConfigDir, "policies")
	os.MkdirAll(userPoliciesDir, 0755)

	userConfig := `
platform:
  mode: auto
policies:
  default: user-policy
`
	os.WriteFile(userConfigFile, []byte(userConfig), 0644)

	// Create a simple policy
	userPolicy := `
name: user-policy
commands:
  allow:
    - ls
`
	os.WriteFile(filepath.Join(userPoliciesDir, "user-policy.yaml"), []byte(userPolicy), 0644)

	// Test: Load config from user location via AEP_CAW_CONFIG env var
	// (Since we can't easily mock GetUserConfigDir, we use the env var approach)
	os.Setenv("AEP_CAW_CONFIG", userConfigFile)
	defer os.Unsetenv("AEP_CAW_CONFIG")

	cfg, source, err := loadLocalConfig("")
	if err != nil {
		t.Fatalf("loadLocalConfig() error = %v", err)
	}
	if source != config.ConfigSourceEnv {
		t.Errorf("source = %v, want ConfigSourceEnv", source)
	}
	if cfg.Policies.Default != "user-policy" {
		t.Errorf("Policies.Default = %q, want %q", cfg.Policies.Default, "user-policy")
	}

	// Verify that source-aware defaults are applied based on the env source
	// (The config file is in a custom location, so defaults should derive from that)
	expectedDataDir := filepath.Dir(userConfigFile)
	expectedSessionsDir := filepath.Join(expectedDataDir, "sessions")
	if cfg.Sessions.BaseDir != expectedSessionsDir {
		t.Errorf("Sessions.BaseDir = %q, want %q", cfg.Sessions.BaseDir, expectedSessionsDir)
	}
}
