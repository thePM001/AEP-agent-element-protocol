package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const gapConfigYAML = `server:
  http:
    addr: "127.0.0.1:18099"
kernel_dock:
  enabled: false
  dock: "validation_engine"
policies:
  dir: "/etc/aep-caw/policies"
  default: "agent-default"
`

// gapConfigTwin wraps a YAML server config as the config block of a GAP document.
func gapConfigTwin(yamlConfig string) string {
	var b strings.Builder
	b.WriteString("address:\n  domain: dev.aep.caw\n  id: server-config.v1\npattern: |\n  CAW server config written as GAP.\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  wrap: caw\n")
	b.WriteString("---\nkind: aep.caw.server_config\nconfig:\n")
	for _, line := range strings.Split(strings.TrimRight(yamlConfig, "\n"), "\n") {
		b.WriteString("  " + line + "\n")
	}
	return b.String()
}

func writeConfigFile(t *testing.T, name, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestGAPServerConfigLoadsLikeItsYAMLTwin(t *testing.T) {
	fromYAML, err := Load(writeConfigFile(t, "config.yaml", gapConfigYAML))
	if err != nil {
		t.Fatalf("YAML twin: %v", err)
	}
	fromGAP, err := Load(writeConfigFile(t, "config.gap", gapConfigTwin(gapConfigYAML)))
	if err != nil {
		t.Fatalf("GAP twin: %v", err)
	}
	if fromGAP.Server.HTTP.Addr != "127.0.0.1:18099" || fromGAP.Policies.Default != "agent-default" {
		t.Fatalf("GAP config lost its values: addr=%q default=%q", fromGAP.Server.HTTP.Addr, fromGAP.Policies.Default)
	}
	if !reflect.DeepEqual(fromYAML, fromGAP) {
		t.Fatal("GAP twin loaded to a different config than the YAML twin")
	}
}

func TestLoadWithSourceReadsAGAPServerConfig(t *testing.T) {
	cfg, _, err := LoadWithSource(writeConfigFile(t, "config.gap", gapConfigTwin(gapConfigYAML)), ConfigSourceEnv)
	if err != nil || cfg.Server.HTTP.Addr != "127.0.0.1:18099" {
		t.Fatalf("LoadWithSource(.gap) = %v, %v", cfg, err)
	}
}

func TestGAPConfigWithoutServerConfigDocumentIsRefused(t *testing.T) {
	body := "address:\n  id: x\npattern: none\n---\nkind: aep.caw.profile\nprofile_id: x\n"
	if _, err := Load(writeConfigFile(t, "config.gap", body)); err == nil {
		t.Fatal("GAP file without a server config document = nil error, want a refusal")
	}
}
